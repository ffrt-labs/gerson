import { describe, it, expect } from 'vitest';
import { writeStoreZip, type ZipEntry, type ZipSink } from '../zip.ts';

function collectingSink(): { sink: ZipSink; bytes: () => Uint8Array } {
  const chunks: Uint8Array[] = [];
  return {
    sink: { write: async (chunk) => { chunks.push(chunk); } },
    bytes: () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    },
  };
}

// Minimal STORE-only zip reader, independent of writeStoreZip's own byte
// layout choices, so the test actually exercises the format rather than
// mirroring the implementation.
function readStoreZip(zip: Uint8Array): Array<{ name: string; bytes: Uint8Array; crc: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const td = new TextDecoder();

  // Locate EOCD by its signature (no comment is ever written, so it's a
  // fixed 22 bytes from the end).
  const eocdOffset = zip.length - 22;
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const results: Array<{ name: string; bytes: Uint8Array; crc: number }> = [];
  let cOff = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    expect(view.getUint32(cOff, true)).toBe(0x02014b50);
    const crc = view.getUint32(cOff + 16, true);
    const nameLen = view.getUint16(cOff + 28, true);
    const extraLen = view.getUint16(cOff + 30, true);
    const commentLen = view.getUint16(cOff + 32, true);
    const localOffset = view.getUint32(cOff + 42, true);
    const name = td.decode(zip.subarray(cOff + 46, cOff + 46 + nameLen));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(localOffset + 18, true); // compressed == uncompressed (STORE)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const bytes = zip.slice(dataStart, dataStart + size);

    results.push({ name, bytes, crc });
    cOff += 46 + nameLen + extraLen + commentLen;
  }

  return results;
}

describe('writeStoreZip', () => {
  it('round-trips filenames and exact bytes for multiple entries', async () => {
    const entries: ZipEntry[] = [
      { name: 'vocals.flac', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'drums.flac', bytes: new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256)) },
      { name: 'bass.flac', bytes: new Uint8Array([]) },
      { name: 'other.flac', bytes: new Uint8Array([255, 0, 128]) },
    ];

    const { sink, bytes } = collectingSink();
    await writeStoreZip(sink, entries);
    const read = readStoreZip(bytes());

    expect(read.map(r => r.name)).toEqual(entries.map(e => e.name));
    for (let i = 0; i < entries.length; i++) {
      expect(Array.from(read[i].bytes)).toEqual(Array.from(entries[i].bytes));
    }
  });

  it('computes the standard CRC-32 check value for "123456789"', async () => {
    const payload = new TextEncoder().encode('123456789');
    const { sink, bytes } = collectingSink();
    await writeStoreZip(sink, [{ name: 'x.txt', bytes: payload }]);
    const [entry] = readStoreZip(bytes());

    expect(entry.crc).toBe(0xcbf43926);
  });

  it('writes an entry with STORE method (no compression)', async () => {
    const payload = new Uint8Array(64).fill(7);
    const { sink, bytes } = collectingSink();
    await writeStoreZip(sink, [{ name: 'flat.bin', bytes: payload }]);
    const zip = bytes();
    const view = new DataView(zip.buffer);

    expect(view.getUint16(8, true)).toBe(0); // local header compression method
  });

  it('produces a zip whose byte length matches the sum of what was written to the sink', async () => {
    const entries: ZipEntry[] = [{ name: 'a', bytes: new Uint8Array(10) }, { name: 'b', bytes: new Uint8Array(20) }];
    const written: Uint8Array[] = [];
    const sink: ZipSink = { write: async (c) => { written.push(c); } };
    await writeStoreZip(sink, entries);

    const total = written.reduce((n, c) => n + c.length, 0);
    // Sanity: header/data/central-dir/EOCD were all actually written, not
    // skipped — an empty or truncated stream would fail readStoreZip above.
    expect(total).toBeGreaterThan(30 * entries.length + 10 + 20 + 22);
  });
});
