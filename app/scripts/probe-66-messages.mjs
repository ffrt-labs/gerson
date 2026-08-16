/**
 * Ticket #66 probe: what messages does demucs.wasm actually post during
 * inference, and how does wasm memory grow?
 *
 * Records every postMessage the module makes (not just PROGRESS_UPDATE) with
 * a timestamp and the live wasm heap size, for a short segment.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const wasmDir = '/Users/freitasfa/Documents/projects/gerson/wasm/dist';
const modelPath = '/Users/freitasfa/Documents/projects/gerson/app/public/model/ggml-model-htdemucs-4s-f16.bin';

const t0 = Date.now();
const counts = new Map();
const samples = [];
let Module = null;
const initLogs = [];
const demixLogs = [];
globalThis.__phase = 'init';

globalThis.postMessage = (msg) => {
  const kind = msg?.msg ?? '(unknown)';
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  if (kind === 'WASM_LOG') { (globalThis.__phase === 'demix' ? demixLogs : initLogs).push(msg.data); }
  if (kind !== 'PROGRESS_UPDATE' && counts.get(kind) <= 3) {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${kind}:`, JSON.stringify(msg.data)?.slice(0, 200));
  }
  if (kind === 'PROGRESS_UPDATE') {
    samples.push({
      t: ((Date.now() - t0) / 1000).toFixed(1),
      progress: msg.data,
      heapMB: Module ? (Module.HEAPU8.byteLength / 1048576).toFixed(0) : '?',
    });
  }
};

const { default: createModule } = await import(path.join(wasmDir, 'demucs.js'));
Module = await createModule({ locateFile: (f) => path.join(wasmDir, f) });
console.log('module loaded, heap MB:', (Module.HEAPU8.byteLength / 1048576).toFixed(0));

const modelBytes = readFileSync(modelPath);
const mptr = Module._malloc(modelBytes.length);
Module.HEAPU8.set(modelBytes, mptr);
Module._modelInit(mptr, modelBytes.length);
Module._free(mptr);
console.log('model init done, heap MB:', (Module.HEAPU8.byteLength / 1048576).toFixed(0));

const SECONDS = Number(process.argv[2] ?? 10);
const n = Math.round(44100 * SECONDS);
const bytes = n * 4;
const L = Module._malloc(bytes);
const R = Module._malloc(bytes);
const outs = Array.from({ length: 14 }, () => Module._malloc(bytes));
const sig = new Float32Array(n);
for (let i = 0; i < n; i++) sig[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;
Module.HEAPF32.set(sig, L >>> 2);
Module.HEAPF32.set(sig, R >>> 2);
console.log(`before demix (${SECONDS}s audio), heap MB:`, (Module.HEAPU8.byteLength / 1048576).toFixed(0));

globalThis.__phase = 'demix';
const tStart = Date.now();
Module._modelDemixSegment(L, R, n, ...outs, false);
const elapsed = (Date.now() - tStart) / 1000;

console.log('--- results ---');
console.log('elapsed s:', elapsed.toFixed(1), '| realtime ratio:', (elapsed / SECONDS).toFixed(1) + 'x');
console.log('peak heap MB:', (Module.HEAPU8.byteLength / 1048576).toFixed(0));
console.log('message counts:', Object.fromEntries(counts));
console.log('WASM_LOG during init:', initLogs.length, '| during demix:', demixLogs.length);
console.log('first 8 demix logs:', JSON.stringify(demixLogs.slice(0,8)));
console.log('progress samples:', JSON.stringify(samples));
