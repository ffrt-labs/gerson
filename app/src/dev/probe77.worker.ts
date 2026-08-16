/**
 * TEMPORARY probe for issue #77 — "Why does _modelDemixSegment hang in Chrome
 * where Node completes?".  Not part of the app; delete with the branch.
 *
 * #74 observed the worker emit `WASM_LOG "Copying waveforms"` and then never
 * post again, and concluded the hang was *inside* the wasm call. But that log
 * is the last instrumentation point that exists: nothing between it and the
 * first `writeStem` logs anything, so "inside the wasm" was assumed, not shown.
 * Everything after that log — the tail of modelDemixSegment's copy loop, and
 * the whole of worker.ts's per-role stem/peaks/FLAC/OPFS path — is unobserved.
 *
 * This probe reproduces that unobserved region *without paying for the 8-minute
 * inference*: it grows the wasm heap to the same 3252 MB peak #74 measured,
 * frees the ballast (leaving the heap grown but free, exactly as it is when
 * demucs_inference returns), fills the output slots with signal, and then runs
 * worker.ts's post-inference path verbatim with a timestamp around every step.
 *
 * If the hang reproduces here, it is in the JS tail, not the wasm.
 * If it does not, the wasm copy loop is implicated and the full run is needed.
 */

import { createEncoder } from '../codec/flac.ts';
import { writeStem, writePeaks } from '../storage/opfs.ts';
import { computePeaks } from '../separation/peaks.ts';
import { ROLES } from '../domain/types.ts';

const SAMPLE_RATE = 44100;
const MB = 1048576;

interface DemucsModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _modelInit(modelPtr: number, modelSize: number): void;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

const t0 = performance.now();
let mod: DemucsModule | null = null;

function step(name: string, detail?: Record<string, unknown>): void {
  self.postMessage({
    type: 'probe77',
    at: +(performance.now() - t0).toFixed(1),
    iso: new Date().toISOString(),
    step: name,
    heapMB: mod ? Math.round(mod.HEAPU8.byteLength / MB) : null,
    ...detail,
  });
}

async function loadDemucsModule(): Promise<DemucsModule> {
  const text = await fetch('/wasm/demucs.js').then(r => r.text());
  const blob = new Blob([`${text}\nexport default libdemucs;`], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const { default: factory } = await import(/* @vite-ignore */ url) as {
      default: (opts: { locateFile: (f: string) => string }) => Promise<DemucsModule>;
    };
    return factory({ locateFile: (f) => `/wasm/${f}` });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Grow the heap to `targetMB` the way inference does — by asking for it — then
 * hand it back. Emscripten's ALLOW_MEMORY_GROWTH never shrinks the WebAssembly
 * Memory, so what is left is a grown-but-mostly-free heap: the exact state
 * worker.ts's post-inference loop actually runs in.
 */
function growHeapTo(m: DemucsModule, targetMB: number): { reached: number; nulls: number } {
  let nulls = 0;
  const chunks: number[] = [];
  // 128 MB at a time: one 3 GB malloc would fail for fragmentation reasons
  // that have nothing to do with the ceiling under test.
  while (m.HEAPU8.byteLength / MB < targetMB) {
    const p = m._malloc(128 * MB);
    if (p === 0) { nulls++; break; }
    chunks.push(p);
  }
  for (const p of chunks) m._free(p);
  return { reached: Math.round(m.HEAPU8.byteLength / MB), nulls };
}

async function run(durationSec: number): Promise<void> {
  step('start', { durationSec });

  mod = await loadDemucsModule();
  step('module-loaded');

  // Served straight from public/ rather than read from OPFS, so the probe does
  // not depend on the app having completed a model download in this profile.
  const modelBytes = new Uint8Array(
    await fetch('/model/ggml-model-htdemucs-4s-f16.bin').then(r => r.arrayBuffer()),
  );
  const mptr = mod._malloc(modelBytes.length);
  mod.HEAPU8.set(modelBytes, mptr);
  mod._modelInit(mptr, modelBytes.length);
  mod._free(mptr);
  step('model-loaded', { modelMB: Math.round(modelBytes.length / MB) });

  const numSamples = Math.round(SAMPLE_RATE * durationSec);
  const bytesF32 = numSamples * 4;
  const f32idx = (ptr: number) => ptr >>> 2;

  const ptrL = mod._malloc(bytesF32);
  const ptrR = mod._malloc(bytesF32);
  const outPtrs = Array.from({ length: 14 }, () => mod!._malloc(bytesF32));
  const nulls = [ptrL, ptrR, ...outPtrs].filter(p => p === 0).length;
  step('buffers-malloced', { numSamples, nullPtrs: nulls, buffersMB: Math.round((16 * bytesF32) / MB) });
  if (nulls > 0) { step('ABORT: malloc returned NULL'); return; }

  // #74 measured a 3252 MB peak in Chrome for a 231 s song. Reproduce it.
  const grown = growHeapTo(mod, 3252);
  step('heap-grown', grown);

  // Plausible stem content: silence would make FLAC's level-5 encoder do
  // almost no work and would hide exactly the kind of cost we are hunting.
  const sig = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) sig[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;
  for (let slot = 0; slot < 8; slot++) mod.HEAPF32.set(sig, f32idx(outPtrs[slot]));
  step('outputs-filled');

  const id = `probe77-${Date.now()}`;

  // ─── verbatim from worker.ts's post-inference loop ────────────────────────
  const STEM_OUTPUT_INDEX: Record<string, number> = { drums: 0, bass: 1, other: 2, vocals: 3 };

  for (const role of ROLES) {
    const slotIdx = STEM_OUTPUT_INDEX[role];
    const leftBase = f32idx(outPtrs[slotIdx * 2]);
    const rightBase = f32idx(outPtrs[slotIdx * 2 + 1]);

    step(`${role}:alloc-stems`);
    const stemL = new Float32Array(numSamples);
    const stemR = new Float32Array(numSamples);
    stemL.set(mod.HEAPF32.subarray(leftBase, leftBase + numSamples));
    stemR.set(mod.HEAPF32.subarray(rightBase, rightBase + numSamples));
    step(`${role}:stems-copied`);

    const peaks = computePeaks(stemL, stemR);
    step(`${role}:peaks-computed`, { peakBytes: peaks.byteLength });

    const encoder = await createEncoder(2, 44100, { ROLE: role.toUpperCase(), ID: id });
    step(`${role}:encoder-created`);

    encoder.push([stemL, stemR]);
    step(`${role}:encoder-pushed`);

    const flacBytes = encoder.finish();
    step(`${role}:encoder-finished`, { flacMB: +(flacBytes.byteLength / MB).toFixed(1) });

    await writeStem(id, role, flacBytes);
    step(`${role}:stem-written`);

    await writePeaks(id, role, peaks);
    step(`${role}:peaks-written`);
  }

  for (const ptr of [ptrL, ptrR, ...outPtrs]) mod._free(ptr);
  step('DONE');
}

self.addEventListener('message', (evt: MessageEvent<{ durationSec: number }>) => {
  run(evt.data.durationSec).catch((e: unknown) => {
    step('THREW', { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  });
});
