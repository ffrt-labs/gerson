/**
 * TEMPORARY probe for issue #78 — "Why is libflac 1000x slower in Chrome after
 * a full-length inference?".  Not part of the app; delete with the branch.
 *
 * #77 timed `encoder.push` as a single step and found it spinning at 100% CPU
 * for >=14.5 min where Node takes 1.0 s. But `push` is two unrelated things
 * bolted together (codec/flac.ts):
 *
 *   1. `pcmToInt32Interleaved` — a 10.2M-iteration *JavaScript* loop that
 *      allocates an 81 MB Int32Array, and
 *   2. one `FLAC__stream_encoder_process_interleaved` call into libflac's wasm.
 *
 * `sample(1)` localised the spin to a ~2 KB JIT loop, which fits (1) at least
 * as well as it fits (2). This probe splits that boundary and times each half,
 * so the next session is not still guessing which side of it burns the time.
 *
 * It also answers the structural question #73 is waiting on: does the encode
 * get slow because it shares a *worker* with the 3.25 GB demucs heap, or
 * because it shares a *renderer* with it? Mode `encode` with growMB=0 run
 * alongside a separate `hold` worker isolates exactly that.
 *
 * Every step is timestamped and posted, so the log is readable even if the run
 * never finishes.
 */

import type { Flac } from 'libflacjs';

/**
 * `codec/flac.ts` imports `libflacjs/dist/libflac` — which is the **wasm2js**
 * build: libFLAC compiled to wasm and then transpiled back to plain
 * JavaScript. `libflacjs/dist/libflac.wasm.js` is the real wasm build sitting
 * next to it. Both are loaded here so the probe can time them side by side.
 *
 * FLAC_SCRIPT_LOCATION tells the wasm build where to fetch its sidecar
 * `libflac.wasm.wasm` from; the probe stages a copy in public/.
 */
(self as unknown as { FLAC_SCRIPT_LOCATION: string }).FLAC_SCRIPT_LOCATION = '/';

type Build = 'js' | 'wasm';

async function loadFlacBuild(build: Build): Promise<Flac> {
  const m = build === 'wasm'
    ? await import('libflacjs/dist/libflac.wasm.js')
    : await import('libflacjs/dist/libflac');
  return ((m as unknown as { default?: Flac }).default ?? (m as unknown as Flac));
}

// Same façade as codec/flac.ts, narrowed to the encode path.
interface LibFlacRaw {
  isReady(): boolean;
  on(event: 'ready' | 'error', handler: (e?: unknown) => void): void;
  create_libflac_encoder(
    sampleRate: number, channels: number, bitsPerSample: number,
    compressionLevel: number, totalSamples?: number, verify?: boolean, blockSize?: number,
  ): number;
  init_encoder_stream(id: number, writeCb: (data: Uint8Array) => void): number;
  FLAC__stream_encoder_process_interleaved(id: number, data: Int32Array, samples: number): boolean;
  FLAC__stream_encoder_finish(id: number): boolean;
  FLAC__stream_encoder_delete(id: number): void;
}

interface DemucsModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const COMPRESSION_LEVEL = 5;
const MB = 1048576;

export interface Probe78Request {
  /** Label echoed on every message, so interleaved worker logs stay readable. */
  tag: string;
  /** Grow a demucs wasm heap to this many MB before encoding. 0 = no demucs at all. */
  growMB: number;
  /** How many whole-stem encodes to run back to back. Reveals any tier-up curve. */
  rounds: number;
  /** Stem length in seconds. 231 matches the #74/#77 fixture. */
  durationSec: number;
  /**
   * If > 0, each round also pushes the same stem in chunks of this many
   * seconds, timing every chunk. A single whole-stem push is unobservable
   * while it runs; a chunked push draws the progress curve *inside* the encode,
   * which separates "slow from the start" from "degrades as it goes" from
   * "starts slow then tiers up".
   */
  chunkSec: number;
  /** Keep the worker (and its grown heap) alive after finishing. */
  hold: boolean;
  /** Which libflacjs build to encode with — 'js' is what the app ships today. */
  build: Build;
}

let mod: DemucsModule | null = null;
let tag = '';
const t0 = performance.now();

function step(name: string, detail?: Record<string, unknown>): void {
  self.postMessage({
    type: 'probe78',
    tag,
    at: +(performance.now() - t0).toFixed(1),
    step: name,
    heapMB: mod ? Math.round(mod.HEAPU8.byteLength / MB) : null,
    ...detail,
  });
}

async function getFlac(build: Build): Promise<LibFlacRaw> {
  const raw = (await loadFlacBuild(build)) as unknown as LibFlacRaw;
  return new Promise((resolve, reject) => {
    if (raw.isReady()) resolve(raw);
    else {
      raw.on('ready', () => resolve(raw));
      raw.on('error', (e) => reject(new Error(String(e))));
    }
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
 * Grow the heap the way inference does — ask for it, touch every page so it is
 * genuinely resident, then hand it back. ALLOW_MEMORY_GROWTH never shrinks the
 * WebAssembly.Memory, so what is left is the grown-but-free heap the real
 * post-inference path runs in. (No `_modelInit` here: #77 showed the model
 * weights are not what matters, and skipping them saves an 80 MB fetch.)
 */
function growHeapTo(m: DemucsModule, targetMB: number): { reached: number; nulls: number } {
  let nulls = 0;
  const chunks: number[] = [];
  while (m.HEAPU8.byteLength / MB < targetMB) {
    const p = m._malloc(128 * MB);
    if (p === 0) { nulls++; break; }
    for (let o = p; o < p + 128 * MB; o += 4096) m.HEAPU8[o] = 1;
    chunks.push(p);
  }
  for (const p of chunks) m._free(p);
  return { reached: Math.round(m.HEAPU8.byteLength / MB), nulls };
}

/** Verbatim from codec/flac.ts — the half of `push` that is plain JavaScript. */
function pcmToInt32Interleaved(channels: Float32Array[]): Int32Array {
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

function makeStem(n: number): [Float32Array, Float32Array] {
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(i / 20) * 0.25 + Math.sin(i / 3.1) * 0.05;
    left[i] = v; right[i] = v * 0.9;
  }
  return [left, right];
}

const ms = (from: number) => +(performance.now() - from).toFixed(1);

/** One whole-stem encode, with the two halves of `push` timed separately. */
function encodeWhole(flac: LibFlacRaw, stem: [Float32Array, Float32Array], round: number): void {
  const n = stem[0].length;
  let bytesOut = 0;

  let m0 = performance.now();
  const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, BITS_PER_SAMPLE, COMPRESSION_LEVEL);
  flac.init_encoder_stream(id, (d) => { bytesOut += d.length; });
  step(`r${round}:whole:encoder-created`, { ms: ms(m0) });

  // Half 1 — the JS loop + 81 MB allocation.
  m0 = performance.now();
  const interleaved = pcmToInt32Interleaved(stem);
  step(`r${round}:whole:interleaved`, { ms: ms(m0), intBufMB: +(interleaved.byteLength / MB).toFixed(1) });

  // Half 2 — the single wasm call #77 assumed was the whole of `push`.
  m0 = performance.now();
  const ok = flac.FLAC__stream_encoder_process_interleaved(id, interleaved, n);
  step(`r${round}:whole:wasm-processed`, { ms: ms(m0), ok });

  m0 = performance.now();
  flac.FLAC__stream_encoder_finish(id);
  flac.FLAC__stream_encoder_delete(id);
  step(`r${round}:whole:finished`, { ms: ms(m0), flacMB: +(bytesOut / MB).toFixed(1) });
}

/**
 * The same stem, pushed in chunks, with every chunk timed. This is the only
 * way to see *inside* an encode that may never end.
 */
function encodeChunked(
  flac: LibFlacRaw, stem: [Float32Array, Float32Array], chunkSec: number, round: number,
): void {
  const n = stem[0].length;
  const chunkSamples = Math.round(chunkSec * SAMPLE_RATE);
  let bytesOut = 0;

  const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, BITS_PER_SAMPLE, COMPRESSION_LEVEL);
  flac.init_encoder_stream(id, (d) => { bytesOut += d.length; });
  step(`r${round}:chunked:encoder-created`, { chunkSec });

  let idx = 0;
  for (let off = 0; off < n; off += chunkSamples, idx++) {
    const end = Math.min(off + chunkSamples, n);
    const slice: [Float32Array, Float32Array] = [
      stem[0].subarray(off, end), stem[1].subarray(off, end),
    ];

    const a0 = performance.now();
    const interleaved = pcmToInt32Interleaved(slice);
    const interleaveMs = ms(a0);

    const b0 = performance.now();
    flac.FLAC__stream_encoder_process_interleaved(id, interleaved, end - off);
    const wasmMs = ms(b0);

    step(`r${round}:chunk${idx}`, { interleaveMs, wasmMs });
  }

  flac.FLAC__stream_encoder_finish(id);
  flac.FLAC__stream_encoder_delete(id);
  step(`r${round}:chunked:finished`, { chunks: idx, flacMB: +(bytesOut / MB).toFixed(1) });
}

async function run(req: Probe78Request): Promise<void> {
  tag = req.tag;
  step('start', { ...req });

  if (req.growMB > 0) {
    mod = await loadDemucsModule();
    step('demucs-loaded');
    step('heap-grown', growHeapTo(mod, req.growMB));
  }

  const flac = await getFlac(req.build ?? 'js');
  step('libflac-ready', { build: req.build ?? 'js' });

  const n = Math.round(SAMPLE_RATE * req.durationSec);
  const stem = makeStem(n);
  step('stem-built', { numSamples: n, stemMB: +((n * 8) / MB).toFixed(1) });

  for (let r = 0; r < req.rounds; r++) {
    if (req.chunkSec > 0) encodeChunked(flac, stem, req.chunkSec, r);
    encodeWhole(flac, stem, r);
  }

  step(req.hold ? 'DONE (holding)' : 'DONE');
}

self.addEventListener('message', (evt: MessageEvent<Probe78Request>) => {
  run(evt.data).catch((e: unknown) => {
    step('THREW', { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  });
});
