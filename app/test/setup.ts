/**
 * Test-environment shim for emscripten's wasm loader.
 *
 * libflacjs's real-wasm build (`libflac.wasm.js` — see codec/flac.ts for why
 * that build and not the wasm2js one) resolves its `.wasm` sidecar and then
 * prefers `fetch` whenever `typeof fetch === 'function'`. Under Node that is
 * always true, but the path it hands over is an absolute *filesystem* path,
 * which Node's fetch rejects as an invalid URL — and the rejection escapes
 * the loader's own fallback, so the module simply never becomes ready.
 *
 * In the browser the same code fetches a real bundled URL and this never
 * arises. So this is a Node-only gap, closed here rather than in the codec:
 * serve filesystem paths from disk and pass everything else through.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const nativeFetch = globalThis.fetch;

function localPath(url: string): string | null {
  if (url.startsWith('file://')) return fileURLToPath(url);
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

globalThis.fetch = async function fetchWithLocalFiles(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = localPath(url);
  if (path === null) return nativeFetch(input, init);

  const bytes = new Uint8Array(await readFile(path));
  return new Response(bytes, {
    headers: { 'content-type': path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
  });
} as typeof fetch;
