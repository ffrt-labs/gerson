/**
 * Ticket #68 probe: what is the real PROGRESS_UPDATE cadence and throughput?
 *
 * #69 predicted progress fires at the internal segment boundaries of
 * _modelDemixSegment (7.8 s window, 5.85 s stride), i.e. ~40 updates for a
 * 233 s song. #77 measured the whole call at 509.5 s in Chrome / 500.8 s in
 * Node — a 2.2x realtime ratio, not the 14x the ticket extrapolated from a
 * 1 s clip. This run tests both at full length in one pass.
 *
 * Node is the harness because #77 established that inference timing transfers
 * (509.5 vs 500.8 s, 1.7% apart) and Node can hold the run for ten minutes
 * without a browser in the loop. Audio is synthetic: #77 showed inference
 * cost is content-independent.
 *
 * Usage: node app/scripts/probe-68-cadence.mjs [seconds]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = '/Users/freitasfa/Documents/projects/gerson';
const wasmDir = path.join(repo, 'wasm/dist');
const modelPath = path.join(repo, 'app/public/model/ggml-model-htdemucs-4s-f16.bin');

const SECONDS = Number(process.argv[2] ?? 233);
const OUT = path.join(repo, `probe-68-cadence-${SECONDS}s.json`);

let Module = null;
let tStart = 0;
const updates = [];
const otherCounts = new Map();

globalThis.postMessage = (msg) => {
  const kind = msg?.msg ?? '(unknown)';
  if (kind !== 'PROGRESS_UPDATE') {
    otherCounts.set(kind, (otherCounts.get(kind) ?? 0) + 1);
    return;
  }
  // Only meaningful once the demix call is running.
  if (!tStart) return;
  const at = (Date.now() - tStart) / 1000;
  const prev = updates.length ? updates[updates.length - 1].at : 0;
  updates.push({
    n: updates.length + 1,
    at: +at.toFixed(2),
    gap: +(at - prev).toFixed(2),
    progress: msg.data,
    heapMB: Module ? Math.round(Module.HEAPU8.byteLength / 1048576) : null,
  });
  // Live trail, so a killed run still leaves partial evidence.
  if (updates.length <= 3 || updates.length % 5 === 0) {
    const u = updates[updates.length - 1];
    console.log(`  #${u.n} at ${u.at}s (gap ${u.gap}s) progress=${u.progress} heap=${u.heapMB}MB`);
  }
};

const { default: createModule } = await import(path.join(wasmDir, 'demucs.js'));
Module = await createModule({ locateFile: (f) => path.join(wasmDir, f) });

const modelBytes = readFileSync(modelPath);
const mptr = Module._malloc(modelBytes.length);
Module.HEAPU8.set(modelBytes, mptr);
Module._modelInit(mptr, modelBytes.length);
Module._free(mptr);
console.log('model init done, heap MB:', Math.round(Module.HEAPU8.byteLength / 1048576));

const n = Math.round(44100 * SECONDS);
const bytes = n * 4;
const L = Module._malloc(bytes);
const R = Module._malloc(bytes);
const outs = Array.from({ length: 14 }, () => Module._malloc(bytes));
const sig = new Float32Array(n);
for (let i = 0; i < n; i++) sig[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;
Module.HEAPF32.set(sig, L >>> 2);
Module.HEAPF32.set(sig, R >>> 2);
console.log(`demix start: ${SECONDS}s audio, heap MB:`, Math.round(Module.HEAPU8.byteLength / 1048576));

tStart = Date.now();
Module._modelDemixSegment(L, R, n, ...outs, false);
const elapsed = (Date.now() - tStart) / 1000;

const gaps = updates.map(u => u.gap);
const result = {
  audioSec: SECONDS,
  elapsedSec: +elapsed.toFixed(2),
  realtimeRatio: +(elapsed / SECONDS).toFixed(2),
  updateCount: updates.length,
  firstUpdateAt: updates.length ? updates[0].at : null,
  lastUpdateAt: updates.length ? updates[updates.length - 1].at : null,
  tailAfterLastUpdate: updates.length ? +(elapsed - updates[updates.length - 1].at).toFixed(2) : null,
  gapMin: gaps.length ? Math.min(...gaps) : null,
  gapMax: gaps.length ? Math.max(...gaps) : null,
  gapMean: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : null,
  gapsOver5min: gaps.filter(g => g > 300).length,
  peakHeapMB: Math.round(Module.HEAPU8.byteLength / 1048576),
  otherMessages: Object.fromEntries(otherCounts),
  updates,
};

writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log('--- results ---');
console.log(JSON.stringify({ ...result, updates: `${updates.length} recorded → ${OUT}` }, null, 2));
