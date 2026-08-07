import type { Role, Song } from '../domain/types.ts';

const RECORDINGS_DIR = 'recordings';
const STEMS_DIR = 'stems';
const MODEL_DIR = 'model';
const MODEL_FILE = 'weights.bin';
const MODEL_TEMP_FILE = 'weights.bin.download';

// OPFS path format: "recordings/<hash>"
export function recordingPath(hash: string): string {
  return `${RECORDINGS_DIR}/${hash}`;
}

// Write recording bytes to OPFS before writing the catalogue row.
export async function writeRecording(hash: string, bytes: Uint8Array): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(RECORDINGS_DIR, { create: true });
  const file = await dir.getFileHandle(hash, { create: true });
  const writable = await file.createWritable();
  // Cast: callers always pass Uint8Array backed by a plain ArrayBuffer, not SharedArrayBuffer.
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
  return recordingPath(hash);
}

export async function readRecording(path: string): Promise<Uint8Array> {
  const [dirName, fileName] = path.split('/');
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(dirName);
  const file = await dir.getFileHandle(fileName);
  const fileData = await file.getFile();
  return new Uint8Array(await fileData.arrayBuffer());
}

export function isNotFoundError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

async function ignoreMissing(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (isNotFoundError(e)) return;
    throw e;
  }
}

// Deletes a Recording at the given path plus the stems directory for id, if
// either exists. The shared shape behind deleteSeparationBytes (an upload
// that never became a Song) and deleteSongBytes (a Song being removed
// outright) — both leave nothing behind but a Recording that was never
// written to begin with.
async function deleteRecordingAndStems(id: string, recordingPath: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const [dirName, fileName] = recordingPath.split('/');

  await ignoreMissing(async () => {
    const dir = await root.getDirectoryHandle(dirName);
    await dir.removeEntry(fileName);
  });

  await ignoreMissing(async () => {
    const stems = await root.getDirectoryHandle(STEMS_DIR);
    await stems.removeEntry(id, { recursive: true });
  });
}

// Deletes everything a non-succeeding Separation left behind: the uploaded
// Recording and any stems written before it was cancelled or failed.
// Best-effort on missing entries — a Separation that never got far enough
// to write anything is not an error.
export async function deleteSeparationBytes(id: string, uploadPath: string): Promise<void> {
  await deleteRecordingAndStems(id, uploadPath);
}

// Deletes every OPFS file a Song referenced: its Recording and all four
// stems (and their peaks), leaving nothing orphaned. Best-effort on missing
// entries.
export async function deleteSongBytes(song: Song): Promise<void> {
  await deleteRecordingAndStems(song.id, song.recording.path);
}

export function stemPath(id: string, role: Role): string {
  return `${STEMS_DIR}/${id}/${role}.flac`;
}

export function peaksPath(id: string, role: Role): string {
  return `${STEMS_DIR}/${id}/${role}.peaks`;
}

async function getStemDir(id: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const stems = await root.getDirectoryHandle(STEMS_DIR, { create: true });
  return stems.getDirectoryHandle(id, { create: true });
}

export async function writeStem(id: string, role: Role, bytes: Uint8Array): Promise<void> {
  const dir = await getStemDir(id);
  const file = await dir.getFileHandle(`${role}.flac`, { create: true });
  const writable = await file.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

export async function writePeaks(id: string, role: Role, data: Int8Array): Promise<void> {
  const dir = await getStemDir(id);
  const file = await dir.getFileHandle(`${role}.peaks`, { create: true });
  const writable = await file.createWritable();
  await writable.write(data.buffer as ArrayBuffer);
  await writable.close();
}

async function resolveFileHandle(path: string): Promise<FileSystemFileHandle> {
  const [dir0, dir1, fileName] = path.split('/');
  const root = await navigator.storage.getDirectory();
  const d0 = await root.getDirectoryHandle(dir0);
  const d1 = await d0.getDirectoryHandle(dir1);
  return d1.getFileHandle(fileName);
}

export async function readStem(path: string): Promise<Uint8Array> {
  const file = await resolveFileHandle(path);
  return new Uint8Array(await (await file.getFile()).arrayBuffer());
}

export async function readPeaks(path: string): Promise<Int8Array> {
  const file = await resolveFileHandle(path);
  return new Int8Array(await (await file.getFile()).arrayBuffer());
}

// ─── Separation model weights (spec §7.3, §8) ─────────────────────────────────
//
// Lives in its own OPFS directory, never Cache Storage, so an app update
// can't purge an 80 MB download the user already paid for. The temp/final
// split lets a download be verified before it can ever be mistaken for a
// ready model — see writeModelTemp/commitModelTemp below.

async function getModelDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODEL_DIR, { create });
}

export async function modelReady(): Promise<boolean> {
  try {
    const dir = await getModelDir(false);
    await dir.getFileHandle(MODEL_FILE);
    return true;
  } catch (e) {
    if (isNotFoundError(e)) return false;
    throw e;
  }
}

export async function readModel(): Promise<Uint8Array> {
  const dir = await getModelDir(false);
  const file = await dir.getFileHandle(MODEL_FILE);
  return new Uint8Array(await (await file.getFile()).arrayBuffer());
}

// Writes freshly-downloaded bytes under the temporary name only — nothing
// reads this name as "the model", so a crash mid-write here never leaves a
// truncated file where modelReady() would find it.
export async function writeModelTemp(bytes: Uint8Array): Promise<void> {
  const dir = await getModelDir(true);
  const file = await dir.getFileHandle(MODEL_TEMP_FILE, { create: true });
  const writable = await file.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

// Promotes a verified temp download to the name the separation worker
// trusts. Uses the platform rename when available; falls back to a copy
// (verified bytes only — never called before verification passes) plus
// deleting the temp file when it isn't.
export async function commitModelTemp(): Promise<void> {
  const dir = await getModelDir(true);
  const tempHandle = await dir.getFileHandle(MODEL_TEMP_FILE);
  const movable = tempHandle as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
  if (typeof movable.move === 'function') {
    await movable.move(MODEL_FILE);
    return;
  }
  const bytes = new Uint8Array(await (await tempHandle.getFile()).arrayBuffer());
  const finalHandle = await dir.getFileHandle(MODEL_FILE, { create: true });
  const writable = await finalHandle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
  await dir.removeEntry(MODEL_TEMP_FILE);
}

export async function deleteModelTemp(): Promise<void> {
  await ignoreMissing(async () => {
    const dir = await getModelDir(false);
    await dir.removeEntry(MODEL_TEMP_FILE);
  });
}
