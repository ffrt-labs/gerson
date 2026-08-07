import type { Separation } from '../domain/types.ts';
import { hashBytes } from './hash.ts';
import { isMobileUA } from './mobile.ts';
import { checkSpace } from './space.ts';
import { decodeAudio, DecodeError } from './decode.ts';
import { getSong, getSeparation, getAllSeparations, putSeparation } from '../storage/db.ts';
import { writeRecording } from '../storage/opfs.ts';
import { nextQueueOrder } from '../separation/queue.ts';
import { getModelState } from '../separation/model.ts';

export type EnqueueResult =
  | { kind: 'queued'; separation: Separation }
  | { kind: 'exists'; id: string; title: string }
  | { kind: 'inflight'; id: string; title: string }
  | { kind: 'mobile' }
  | { kind: 'nospace'; needsBytes: number }
  | { kind: 'decode_failed'; message: string }
  | { kind: 'model_absent' }
  | { kind: 'model_downloading' };

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export async function enqueue(file: File): Promise<EnqueueResult> {
  // Cheapest guard first.
  if (isMobileUA()) {
    return { kind: 'mobile' };
  }

  // Read the file once. We need a copy for decoding (decodeAudioData detaches
  // the input buffer) and the original for hashing and storage.
  const originalBuffer = await file.arrayBuffer();
  const storageBytes = new Uint8Array(originalBuffer.slice(0));

  // Content hash → id. Computed from the bytes we will store.
  const id = await hashBytes(storageBytes);

  // Duplicate detection before any expensive work.
  const existingSong = await getSong(id);
  if (existingSong) {
    return { kind: 'exists', id, title: existingSong.title };
  }

  const existingSep = await getSeparation(id);
  if (existingSep && existingSep.status !== 'failed') {
    return { kind: 'inflight', id, title: existingSep.title };
  }

  // Reads the three-valued model state (spec §7.3, §8) before this file
  // commits to a fresh Separation. Checked after the exists/inflight guards
  // above so re-opening a known Song, or a retry of an already-failed job,
  // never gets blocked on a model it doesn't need.
  const modelState = await getModelState();
  if (modelState === 'absent') return { kind: 'model_absent' };
  if (modelState === 'downloading') return { kind: 'model_downloading' };

  // Storage pre-flight before the decode — refuse up front if the result won't fit.
  const spaceResult = await checkSpace(storageBytes.byteLength);
  if (!spaceResult.ok) {
    return { kind: 'nospace', needsBytes: spaceResult.needsBytes };
  }

  // Decode validates the file. originalBuffer is detached after this call.
  // No Separation is created if the file can't be decoded.
  let durationSec: number;
  try {
    ({ durationSec } = await decodeAudio(originalBuffer));
  } catch (e) {
    if (e instanceof DecodeError) {
      return { kind: 'decode_failed', message: e.message };
    }
    throw e;
  }

  // OPFS write comes before the catalogue row so that a crash between the two
  // leaves unreferenced bytes rather than a dangling catalogue entry.
  const uploadPath = await writeRecording(id, storageBytes);

  // Request persistent storage on the first save.
  await navigator.storage.persist();

  const existing = await getAllSeparations();
  const separation: Separation = {
    id,
    title: stripExtension(file.name),
    durationSec,
    status: 'queued',
    uploadPath,
    progress: 0,
    error: null,
    cause: null,
    failedAt: null,
    startedAt: Date.now(),
    interrupted: false,
    queueOrder: nextQueueOrder(existing),
  };
  await putSeparation(separation);

  return { kind: 'queued', separation };
}
