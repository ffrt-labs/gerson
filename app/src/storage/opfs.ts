import type { Role } from '../domain/types.ts';

const RECORDINGS_DIR = 'recordings';
const STEMS_DIR = 'stems';

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

async function ignoreMissing(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return;
    throw e;
  }
}

// Deletes everything a non-succeeding Separation left behind: the uploaded
// Recording and any stems written before it was cancelled or failed.
// Best-effort on missing entries — a Separation that never got far enough
// to write anything is not an error.
export async function deleteSeparationBytes(id: string, uploadPath: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const [dirName, fileName] = uploadPath.split('/');

  await ignoreMissing(async () => {
    const dir = await root.getDirectoryHandle(dirName);
    await dir.removeEntry(fileName);
  });

  await ignoreMissing(async () => {
    const stems = await root.getDirectoryHandle(STEMS_DIR);
    await stems.removeEntry(id, { recursive: true });
  });
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
