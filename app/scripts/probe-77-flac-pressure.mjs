/**
 * TEMPORARY probe for #77. Delete with the branch.
 *
 * probe-77-flac-data.mjs ruled out the audio: every stem encodes in ~1 s.
 * The other difference between the 1 s bench and the 13-minute browser hang is
 * the memory state — in the real worker, libflac is asked to grow its own wasm
 * heap while the demucs module next to it is already holding a fully-resident
 * 3252 MB WebAssembly.Memory.
 *
 * This reproduces that condition without a browser and without inference: grow
 * the demucs heap to 3252 MB, *touch every page* so it is genuinely resident
 * (a malloc'd-then-freed heap is not), and only then run the same one-call
 * whole-stem encode. It also times a chunked encode alongside, since chunk size
 * is the lever the fix spec would actually have.
 *
 *   node --max-old-space-size=8192 probe-77-flac-pressure.mjs [chunkSec]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const WASM_DIR = '/Users/freitasfa/Documents/projects/gerson/wasm/dist';
const MODEL = '/Users/freitasfa/Documents/projects/gerson/app/public/model/ggml-model-htdemucs-4s-f16.bin';
const SAMPLE_RATE = 44100;
const DURATION = 231;
const MB = 1048576;
const N = SAMPLE_RATE * DURATION;
const chunkSec = Number(process.argv[2] ?? 0); // 0 = one whole-stem call

const rssMB = () => Math.round(process.memoryUsage.rss() / MB);

const mod = (await import('libflacjs/dist/libflac.js')).default;
const flac = await new Promise((res, rej) => {
  if (mod.isReady()) res(mod); else { mod.on('ready', () => res(mod)); mod.on('error', rej); }
});

function pcmToInt32Interleaved(channels) {
  const numCh = channels.length;
  const numSamples = channels[0].length;
  const out = new Int32Array(numSamples * numCh);
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.round(channels[ch][i] * 32767);
      out[i * numCh + ch] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
  }
  return out;
}

function encode(left, right, chunkSamples) {
  const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, 16, 5);
  let bytes = 0;
  flac.init_encoder_stream(id, (d) => { bytes += d.length; });
  const t0 = Date.now();
  const step = chunkSamples || left.length;
  for (let off = 0; off < left.length; off += step) {
    const end = Math.min(off + step, left.length);
    const inter = pcmToInt32Interleaved([left.subarray(off, end), right.subarray(off, end)]);
    flac.FLAC__stream_encoder_process_interleaved(id, inter, end - off);
  }
  const ms = Date.now() - t0;
  flac.FLAC__stream_encoder_finish(id);
  flac.FLAC__stream_encoder_delete(id);
  return { sec: +(ms / 1000).toFixed(1), flacMB: +(bytes / MB).toFixed(1) };
}

const stem = new Float32Array(N);
for (let i = 0; i < N; i++) stem[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;

console.log(`baseline rss=${rssMB()}MB`);
console.log('  no pressure:', JSON.stringify(encode(stem, stem, chunkSec * SAMPLE_RATE)));

// Now the real condition: a resident 3252 MB demucs heap alongside.
const { default: createModule } = await import(path.join(WASM_DIR, 'demucs.js'));
globalThis.postMessage = () => {};
const Module = await createModule({ locateFile: (f) => path.join(WASM_DIR, f) });
const modelBytes = readFileSync(MODEL);
const mptr = Module._malloc(modelBytes.length);
Module.HEAPU8.set(modelBytes, mptr);
Module._modelInit(mptr, modelBytes.length);
Module._free(mptr);

const held = [];
while (Module.HEAPU8.byteLength / MB < 3252) {
  const p = Module._malloc(128 * MB);
  if (p === 0) break;
  held.push(p);
  // Touch every 4 KB page — an untouched heap costs no physical memory, and
  // physical residency is the whole point of the comparison.
  for (let o = p; o < p + 128 * MB; o += 4096) Module.HEAPU8[o] = 1;
}
console.log(`demucs heap=${Math.round(Module.HEAPU8.byteLength / MB)}MB resident rss=${rssMB()}MB`);
console.log('  under pressure:', JSON.stringify(encode(stem, stem, chunkSec * SAMPLE_RATE)));
console.log(`final rss=${rssMB()}MB`);
