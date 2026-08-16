// The real wasm build, for comparison with the wasm2js build codec/flac.ts imports.
// Node can't fetch() the sidecar .wasm by absolute path, so hand it the bytes.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const wasmPath = req.resolve('libflacjs/dist/libflac.wasm.wasm');
// Node 22 exposes global fetch, so emscripten takes the web path and fetches
// the sidecar .wasm by absolute filesystem path. Shim that one case.
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => (typeof u === 'string' && u.startsWith('/'))
  ? Promise.resolve(new Response(readFileSync(u), { headers: { 'content-type': 'application/wasm' } }))
  : realFetch(u, o);
const mod = (await import('libflacjs/dist/libflac.wasm.js')).default;
const flac = await new Promise((res, rej) => mod.isReady() ? res(mod) : (mod.on('ready',()=>res(mod)), mod.on('error',rej)));
const SR = 44100, n = Math.round(SR * 231);
const il = new Int32Array(n * 2);
for (let i = 0; i < n; i++) {
  const v = Math.round((Math.sin(i/20)*0.25 + Math.sin(i/3.1)*0.05) * 32767);
  il[i*2] = v; il[i*2+1] = Math.round(v*0.9);
}
for (let r = 0; r < 3; r++) {
  const id = flac.create_libflac_encoder(SR, 2, 16, 5);
  let bytes = 0;
  flac.init_encoder_stream(id, (d) => { bytes += d.length; });
  const t = process.hrtime.bigint();
  flac.FLAC__stream_encoder_process_interleaved(id, il, n);
  console.log(`WASM build r${r}: process=${(Number(process.hrtime.bigint()-t)/1e6).toFixed(0)}ms out=${(bytes/1048576).toFixed(1)}MB`);
  flac.FLAC__stream_encoder_finish(id); flac.FLAC__stream_encoder_delete(id);
}
