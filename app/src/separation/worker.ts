import { createEncoder } from '../codec/flac.ts';
import {
  readRecording,
  writeStem,
  writePeaks,
  stemPath,
  peaksPath,
} from '../storage/opfs.ts';
import { commitSeparationToSong, putSeparation } from '../storage/db.ts';
import { computePeaks } from './peaks.ts';
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

// Replaced by consent-gate + verified download in a later iteration.
const MODEL_PATH = '/model/ggml-model-htdemucs-4s-f16.bin';

let demucsModule: DemucsModule | null = null;
let modelLoaded = false;

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

async function loadModel(mod: DemucsModule): Promise<void> {
  const resp = await fetch(MODEL_PATH);
  if (!resp.ok) throw new Error(`Model fetch failed: ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  mod._modelInit(ptr, bytes.length);
  mod._free(ptr);
}

async function decodePCM(bytes: ArrayBuffer): Promise<{
  left: Float32Array;
  right: Float32Array;
  durationSec: number;
}> {
  // decodeAudioData decodes the full file regardless of the context rendering
  // length — length=1 is a cheap way to obtain a decoding context in a worker.
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 });
  const buffer = await ctx.decodeAudioData(bytes);
  const left = buffer.getChannelData(0).slice();
  const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
  return { left, right, durationSec: buffer.duration };
}

function detectMimeType(bytes: Uint8Array): string {
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac';
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';
  return 'application/octet-stream';
}

async function runSeparation(separation: Separation): Promise<Song> {
  const { id, title, uploadPath } = separation;

  await putSeparation({ ...separation, status: 'running', progress: 0 });

  const mod = await ensureReady();

  const recordingBytes = await readRecording(uploadPath);
  const { left: inputL, right: inputR, durationSec } =
    await decodePCM(recordingBytes.buffer.slice(0) as ArrayBuffer);

  const numSamples = inputL.length;
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
    mod.HEAPF32.set(inputL, f32idx(ptrL));
    mod.HEAPF32.set(inputR, f32idx(ptrR));

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

    const stemRefs: Partial<Record<Role, StemRef>> = {};

    for (const role of ROLES) {
      const slotIdx = STEM_OUTPUT_INDEX[role];
      const leftBase = f32idx(outPtrs[slotIdx * 2]);
      const rightBase = f32idx(outPtrs[slotIdx * 2 + 1]);

      const stemL = new Float32Array(numSamples);
      const stemR = new Float32Array(numSamples);
      stemL.set(mod.HEAPF32.subarray(leftBase, leftBase + numSamples));
      stemR.set(mod.HEAPF32.subarray(rightBase, rightBase + numSamples));

      // Same pass: peaks and FLAC both consume raw PCM; no re-decode from disk.
      const peaks = computePeaks(stemL, stemR);
      const encoder = await createEncoder(2, 44100, { ROLE: role.toUpperCase(), ID: id });
      encoder.push([stemL, stemR]);
      const flacBytes = encoder.finish();

      // OPFS before IDB: if tab dies after this line there is no Song row.
      phase = 'storage';
      await writeStem(id, role, flacBytes);
      await writePeaks(id, role, peaks);
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
        bytes: recordingBytes.byteLength,
        mimeType: detectMimeType(recordingBytes),
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

self.addEventListener('message', (evt: MessageEvent<{ type: string; separation: Separation }>) => {
  if (evt.data?.type !== 'run') return;

  const { separation } = evt.data;

  runSeparation(separation).then(
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
