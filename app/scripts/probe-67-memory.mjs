/**
 * Ticket #67 probe: peak memory of one whole-song _modelDemixSegment call.
 *
 *   node probe-67-memory.mjs <durationSec> [full|slim]
 *
 * Prints one JSON line so a sweep can be assembled from separate processes —
 * wasm memory only ever grows, so each duration needs a fresh one.
 *
 * The demix call is synchronous and never yields, so the only place either
 * figure can be sampled mid-run is the wasm's own postMessage callbacks,
 * which run synchronously on this thread. Both are read there.
 *
 * `slim` tests the free lever named in the ticket: the 4-source model never
 * writes output slots 4–6, but worker.ts mallocs all 14 output buffers at full
 * song length. Slim gives slots 8–13 tiny sentinel-filled buffers instead and
 * verifies the sentinels survive — if they do, the six buffers are pure waste.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const WASM_DIR = '/Users/freitasfa/Documents/projects/gerson/wasm/dist';
const MODEL = '/Users/freitasfa/Documents/projects/gerson/app/public/model/ggml-model-htdemucs-4s-f16.bin';
const SAMPLE_RATE = 44100;
const MB = 1048576;

const durationSec = Number(process.argv[2] ?? 30);
const mode = process.argv[3] ?? 'full';

// A NaN duration silently degenerates into a tiny run that still reports
// plausible-looking numbers — refuse rather than emit a misleading row.
if (!Number.isFinite(durationSec) || durationSec <= 0) {
  console.error(`bad durationSec: ${JSON.stringify(process.argv[2])}`);
  process.exit(2);
}
if (mode !== 'full' && mode !== 'slim') {
  console.error(`bad mode: ${JSON.stringify(mode)}`);
  process.exit(2);
}
const SENTINEL_BYTES = 4096;
const SENTINEL = 0xab;

let Module = null;
let peakHeap = 0;
let peakRss = 0;
let progressCount = 0;
let firstGrowthAt = null;

globalThis.postMessage = (msg) => {
  if (!Module) return;
  const heap = Module.HEAPU8.byteLength;
  if (heap > peakHeap) {
    peakHeap = heap;
    if (firstGrowthAt === null && msg?.msg === 'PROGRESS_UPDATE') firstGrowthAt = msg.data;
  }
  const rss = process.memoryUsage.rss();
  if (rss > peakRss) peakRss = rss;
  if (msg?.msg === 'PROGRESS_UPDATE') progressCount++;
};

const result = {
  durationSec, mode,
  numSamples: null, ourBuffersMB: null,
  heapAfterInitMB: null, peakHeapMB: null, peakRssMB: null,
  elapsedSec: null, realtimeRatio: null,
  progressUpdates: null, peakReachedAtProgress: null,
  stemChecksum: null, sentinelsIntact: null,
  failed: null, failureMode: null,
};

try {
  const { default: createModule } = await import(path.join(WASM_DIR, 'demucs.js'));
  Module = await createModule({ locateFile: (f) => path.join(WASM_DIR, f) });

  const modelBytes = readFileSync(MODEL);
  const mptr = Module._malloc(modelBytes.length);
  Module.HEAPU8.set(modelBytes, mptr);
  Module._modelInit(mptr, modelBytes.length);
  Module._free(mptr);
  result.heapAfterInitMB = +(Module.HEAPU8.byteLength / MB).toFixed(0);

  const n = Math.round(SAMPLE_RATE * durationSec);
  const bytes = n * 4;
  result.numSamples = n;

  // Exactly what worker.ts allocates: 2 input + 14 output, all song-length.
  const usedOutputs = mode === 'slim' ? 8 : 14;
  result.ourBuffersMB = +(((2 + usedOutputs) * bytes) / MB).toFixed(0);

  const ptrL = Module._malloc(bytes);
  const ptrR = Module._malloc(bytes);
  const outPtrs = [];
  for (let k = 0; k < usedOutputs; k++) outPtrs.push(Module._malloc(bytes));
  for (let k = usedOutputs; k < 14; k++) {
    const p = Module._malloc(SENTINEL_BYTES);
    Module.HEAPU8.fill(SENTINEL, p, p + SENTINEL_BYTES);
    outPtrs.push(p);
  }

  // worker.ts never checks these. With ALLOW_MEMORY_GROWTH a failed malloc
  // returns NULL, and writing to address 0 is how a clean OOM turns into
  // silent corruption — so the probe checks what the app does not.
  const nullPtrs = [ptrL, ptrR, ...outPtrs].filter(p => p === 0).length;
  if (nullPtrs > 0) {
    result.failed = true;
    result.failureMode = `malloc returned NULL for ${nullPtrs} of 16 buffers (heap ${(Module.HEAPU8.byteLength / MB).toFixed(0)} MB)`;
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;
  Module.HEAPF32.set(sig, ptrL >>> 2);
  Module.HEAPF32.set(sig, ptrR >>> 2);

  peakHeap = Module.HEAPU8.byteLength;
  peakRss = process.memoryUsage.rss();

  const t0 = Date.now();
  Module._modelDemixSegment(ptrL, ptrR, n, ...outPtrs, false);
  result.elapsedSec = +((Date.now() - t0) / 1000).toFixed(1);
  result.realtimeRatio = +(result.elapsedSec / durationSec).toFixed(2);

  if (Module.HEAPU8.byteLength > peakHeap) peakHeap = Module.HEAPU8.byteLength;
  if (process.memoryUsage.rss() > peakRss) peakRss = process.memoryUsage.rss();

  // Cheap fingerprint of the four real stems, so full and slim runs can be
  // compared for identical output.
  let sum = 0;
  for (let slot = 0; slot < 8; slot++) {
    const base = outPtrs[slot] >>> 2;
    for (let i = 0; i < n; i += 997) sum = (sum + Math.round(Module.HEAPF32[base + i] * 1e6)) | 0;
  }
  result.stemChecksum = sum;

  if (mode === 'slim') {
    result.sentinelsIntact = outPtrs.slice(8).every(p => {
      for (let i = 0; i < SENTINEL_BYTES; i++) if (Module.HEAPU8[p + i] !== SENTINEL) return false;
      return true;
    });
  }

  result.failed = false;
  result.progressUpdates = progressCount;
  result.peakReachedAtProgress = firstGrowthAt;
  result.peakHeapMB = +(peakHeap / MB).toFixed(0);
  result.peakRssMB = +(peakRss / MB).toFixed(0);
} catch (e) {
  result.failed = true;
  result.failureMode = `${e?.constructor?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`;
  result.peakHeapMB = +(peakHeap / MB).toFixed(0);
  result.peakRssMB = +(peakRss / MB).toFixed(0);
}

console.log(JSON.stringify(result));
