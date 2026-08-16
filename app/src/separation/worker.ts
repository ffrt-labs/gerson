import { createEncoder } from '../codec/flac.ts';
import {
  readModel,
  writeStem,
  writePeaks,
  stemPath,
  peaksPath,
} from '../storage/opfs.ts';
import { commitSeparationToSong, putSeparation } from '../storage/db.ts';
import { computePeaks } from './peaks.ts';
import type { RecordingPayload } from './decode.ts';
import type { Role, Song, Separation, StemRef, SeparationFailureCause } from '../domain/types.ts';
import { ROLES, defaultPracticeState } from '../domain/types.ts';

// Tags which phase an error came from — worker/compute (decode, inference)
// vs. storage (writing stems, peaks, or committing the Song) — so a failure
// can be reported with a named, not generalised, cause. See spec §7.4.
class SeparationRunError extends Error {
  failureCause: SeparationFailureCause;

  constructor(message: string, failureCause: SeparationFailureCause) {
    super(message);
    this.failureCause = failureCause;
  }
}

interface DemucsModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _modelInit(modelPtr: number, modelSize: number): void;
  _modelDemixSegment(
    leftPtr: number, rightPtr: number, length: number,
    out0L: number, out0R: number,
    out1L: number, out1R: number,
    out2L: number, out2R: number,
    out3L: number, out3R: number,
    out4L: number, out4R: number,
    out5L: number, out5R: number,
    out6L: number, out6R: number,
    batchMode: boolean,
  ): void;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

// Matches smoke test + wasm/README.md output slot ordering.
const STEM_OUTPUT_INDEX: Record<Role, number> = {
  drums:  0,
  bass:   1,
  other:  2,
  vocals: 3,
};

let demucsModule: DemucsModule | null = null;
let modelLoaded = false;

// TEMPORARY (#66/#67): the wasm posts PROGRESS_UPDATE and WASM_LOG from
// *inside* the synchronous _modelDemixSegment call, so this patch is the only
// point at which the heap can be sampled mid-inference — the worker's event
// loop never runs until the call returns. performance.memory and
// measureUserAgentSpecificMemory are both [Exposed=Window] and unavailable
// here; HEAPU8.byteLength is the only trustworthy figure.
const rawPostMessage = self.postMessage.bind(self);
self.postMessage = ((message: unknown, ...rest: unknown[]) => {
  const m = message as { msg?: string } | null;
  if (m && (m.msg === 'PROGRESS_UPDATE' || m.msg === 'WASM_LOG')) {
    (m as { heapBytes?: number }).heapBytes = demucsModule?.HEAPU8.byteLength ?? 0;
    (m as { postedAt?: number }).postedAt = Date.now();
  }
  return (rawPostMessage as (m: unknown, ...r: unknown[]) => void)(message, ...rest);
}) as typeof self.postMessage;

// TEMPORARY (#77): #74 saw the worker fall silent after the wasm's last log
// and assumed the hang was inside _modelDemixSegment — but nothing between
// that log and the first writeStem is instrumented, so "inside the wasm" was
// never actually shown. These marks make every step of the tail observable.
// Posted as a WASM_LOG rather than logged: localStorage is [Exposed=Window] so
// diag() cannot be called here, and the extension driving this experiment does
// not capture a worker's console at all — a mark that only reaches the console
// is a mark that cannot be read back after the hang. Riding the WASM_LOG shape
// means engine.ts's existing fellthrough handler persists it with everything
// else, with no engine change. It lands on the orphaned-job path #66 describes,
// which by this point the real wasm logs have already taken 95 times over.
const p77t0 = Date.now();
function p77(step: string, detail?: Record<string, unknown>): void {
  const heapMB = demucsModule ? Math.round(demucsModule.HEAPU8.byteLength / 1048576) : null;
  const elapsed = ((Date.now() - p77t0) / 1000).toFixed(2);
  self.postMessage({
    msg: 'WASM_LOG',
    data: `[P77] +${elapsed}s ${step} heapMB=${heapMB} ${detail ? JSON.stringify(detail) : ''}`,
  });
}

async function ensureReady(): Promise<DemucsModule> {
  if (!demucsModule) {
    demucsModule = await loadDemucsModule();
  }
  if (!modelLoaded) {
    await loadModel(demucsModule);
    modelLoaded = true;
  }
  return demucsModule;
}

async function loadDemucsModule(): Promise<DemucsModule> {
  // demucs.js is a UMD IIFE — append an ESM export and load via Blob URL
  // so dynamic import can resolve it as a module inside this worker.
  const text = await fetch('/wasm/demucs.js').then(r => {
    if (!r.ok) throw new Error(`Failed to fetch /wasm/demucs.js: ${r.status}`);
    return r.text();
  });
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

// The entry point (intake/enqueue.ts) never lets a Separation reach the
// queue until the model is 'ready', so by the time a job runs here, the
// verified weights are already in OPFS — no network fetch, no consent
// concern inside a worker.
async function loadModel(mod: DemucsModule): Promise<void> {
  const bytes = await readModel();
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  mod._modelInit(ptr, bytes.length);
  mod._free(ptr);
}

// `recording` is decoded on the main thread by engine.ts before dispatch —
// OfflineAudioContext (needed to decode) is undefined inside a Worker's
// global scope in every current browser. See decode.ts.
async function runSeparation(separation: Separation, recording: RecordingPayload): Promise<Song> {
  const { id, title, uploadPath } = separation;
  const { left, right, durationSec, recordingBytes, recordingMimeType } = recording;

  const mod = await ensureReady();

  const numSamples = left.length;
  const bytesF32 = numSamples * 4;
  const f32idx = (ptr: number) => ptr >>> 2;

  const ptrL = mod._malloc(bytesF32);
  const ptrR = mod._malloc(bytesF32);
  // 7 output pairs required by the WASM ABI; only slots 0–3 carry stem audio.
  const outPtrs = Array.from({ length: 14 }, () => mod._malloc(bytesF32));

  // Defaults to the compute phase; flipped around each storage write below so
  // a failure there is reported with cause 'storage', not 'worker'.
  let phase: SeparationFailureCause = 'worker';

  try {
    mod.HEAPF32.set(left, f32idx(ptrL));
    mod.HEAPF32.set(right, f32idx(ptrR));
    p77('inputs-copied', { numSamples, durationSec }); // TEMPORARY (#77)

    // Synchronous call; WASM posts PROGRESS_UPDATE via postMessage during inference.
    mod._modelDemixSegment(
      ptrL, ptrR, numSamples,
      outPtrs[0],  outPtrs[1],
      outPtrs[2],  outPtrs[3],
      outPtrs[4],  outPtrs[5],
      outPtrs[6],  outPtrs[7],
      outPtrs[8],  outPtrs[9],
      outPtrs[10], outPtrs[11],
      outPtrs[12], outPtrs[13],
      false,
    );
    p77('demix-returned'); // TEMPORARY (#77): the mark #74 did not have

    const stemRefs: Partial<Record<Role, StemRef>> = {};

    for (const role of ROLES) {
      const slotIdx = STEM_OUTPUT_INDEX[role];
      const leftBase = f32idx(outPtrs[slotIdx * 2]);
      const rightBase = f32idx(outPtrs[slotIdx * 2 + 1]);

      p77(`${role}:alloc-stems`);
      const stemL = new Float32Array(numSamples);
      const stemR = new Float32Array(numSamples);
      stemL.set(mod.HEAPF32.subarray(leftBase, leftBase + numSamples));
      stemR.set(mod.HEAPF32.subarray(rightBase, rightBase + numSamples));
      p77(`${role}:stems-copied`);

      // Same pass: peaks and FLAC both consume raw PCM; no re-decode from disk.
      const peaks = computePeaks(stemL, stemR);
      p77(`${role}:peaks-computed`);
      const encoder = await createEncoder(2, 44100, { ROLE: role.toUpperCase(), ID: id });
      p77(`${role}:encoder-created`);
      // TEMPORARY (#77): the one lever under test. Identical samples, identical
      // encoder, identical output — only the size of each process_interleaved
      // call changes. The unchunked call is what runs ≥14.5 min at 100% CPU.
      const CHUNK_SAMPLES = 10 * 44100;
      for (let off = 0; off < numSamples; off += CHUNK_SAMPLES) {
        const end = Math.min(off + CHUNK_SAMPLES, numSamples);
        encoder.push([stemL.subarray(off, end), stemR.subarray(off, end)]);
      }
      p77(`${role}:encoder-pushed`, { chunkSec: 10 });
      const flacBytes = encoder.finish();
      p77(`${role}:encoder-finished`, { flacMB: +(flacBytes.byteLength / 1048576).toFixed(1) });

      // OPFS before IDB: if tab dies after this line there is no Song row.
      phase = 'storage';
      await writeStem(id, role, flacBytes);
      p77(`${role}:stem-written`);
      await writePeaks(id, role, peaks);
      p77(`${role}:peaks-written`);
      phase = 'worker';

      stemRefs[role] = { path: stemPath(id, role), bytes: flacBytes.byteLength, peaksPath: peaksPath(id, role) };
    }

    const song: Song = {
      id,
      title,
      durationSec,
      sampleRate: 44100,
      createdAt: Date.now(),
      recording: {
        path: uploadPath,
        bytes: recordingBytes,
        mimeType: recordingMimeType,
        origin: 'uploaded',
      },
      stems: stemRefs as Song['stems'],
      practice: defaultPracticeState(),
    };

    phase = 'storage';
    await commitSeparationToSong(id, song);
    return song;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SeparationRunError(message, phase);
  } finally {
    mod._free(ptrL);
    mod._free(ptrR);
    for (const ptr of outPtrs) mod._free(ptr);
  }
}

self.addEventListener('message', (evt: MessageEvent<{ type: string; separation: Separation } & RecordingPayload>) => {
  if (evt.data?.type !== 'run') return;

  const { separation, left, right, durationSec, recordingBytes, recordingMimeType } = evt.data;

  runSeparation(separation, { left, right, durationSec, recordingBytes, recordingMimeType }).then(
    (song) => { self.postMessage({ type: 'done', song }); },
    (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      const cause: SeparationFailureCause = err instanceof SeparationRunError ? err.failureCause : 'worker';
      const failedAt = Date.now();
      putSeparation({ ...separation, status: 'failed', error, cause, failedAt }).catch(() => undefined);
      self.postMessage({ type: 'failed', error, cause, failedAt });
    },
  );
});
