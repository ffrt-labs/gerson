/**
 * Zip reader for import (§6.2): our own "Export stems" writes a STORE-only
 * zip (export/zip.ts), but third-party stem packs are likely deflated, so
 * this reads both. A zip is a container, not a promise — the caller unpacks
 * it and hands the resulting files down the exact same path as loose files;
 * nothing here is import-aware.
 *
 * Reads the central directory (the authoritative entry list — local headers
 * are only consulted for their header length, since central and local name/
 * extra-field lengths can legitimately differ) and decompresses each entry.
 */

const CENTRAL_FILE_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_EOCD_COMMENT = 65535;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export interface UnzippedFile {
  name: string;
  bytes: Uint8Array;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

// The EOCD sits at the very end unless a zip comment follows it — search
// backwards for its signature within the maximum possible comment length.
function findEOCD(bytes: Uint8Array, view: DataView): number {
  const searchFloor = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_EOCD_COMMENT);
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('Not a valid zip file (no end-of-central-directory record found).');
}

async function decompressEntry(compressed: Uint8Array, method: number, name: string): Promise<Uint8Array> {
  if (method === METHOD_STORE) return compressed.slice();

  if (method === METHOD_DEFLATE) {
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  throw new Error(`"${name}" uses an unsupported zip compression method (${method}).`);
}

/** Strips any folder path a zip entry may carry, keeping only the filename. */
function basename(entryName: string): string {
  const parts = entryName.split('/');
  return parts[parts.length - 1];
}

/**
 * Unpacks a zip's file entries (directory entries are skipped). Supports
 * STORE and DEFLATE; any other compression method throws, naming the entry.
 */
export async function unzip(bytes: Uint8Array): Promise<UnzippedFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEOCD(bytes, view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const results: UnzippedFile[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_FILE_HEADER_SIG) {
      throw new Error('Malformed zip central directory.');
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = readAscii(bytes, offset + 46, nameLen);

    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry — no data to extract

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    const data = await decompressEntry(compressed, method, name);
    results.push({ name: basename(name), bytes: data });
  }

  return results;
}
