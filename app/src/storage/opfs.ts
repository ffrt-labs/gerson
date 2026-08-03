const RECORDINGS_DIR = 'recordings';

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
