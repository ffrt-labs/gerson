import { describe, it, expect } from 'vitest';
import { unzip } from '../unzip.ts';
import { writeStoreZip, type ZipEntry, type ZipSink } from '../../export/zip.ts';

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

async function buildStoreZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const { sink, bytes } = collectingSink();
  await writeStoreZip(sink, entries);
  return bytes();
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Hand-built zip with DEFLATE entries, independent of writeStoreZip's STORE-only format. */
async function buildDeflateZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const te = new TextEncoder();
  const parts: Uint8Array[] = [];
  let offset = 0;
  const centralParts: Uint8Array[] = [];

  for (const entry of entries) {
    const nameBytes = te.encode(entry.name);
    const compressed = await deflateRaw(entry.bytes);
    const localOffset = offset;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true); // method: DEFLATE
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, 0, true); // crc unused by our reader
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    parts.push(local, compressed);
    offset += local.length + compressed.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true); // method: DEFLATE
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const c of centralParts) { parts.push(c); centralDirSize += c.length; }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  parts.push(eocd);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let woff = 0;
  for (const p of parts) { out.set(p, woff); woff += p.length; }
  return out;
}

describe('unzip', () => {
  it('reads a STORE-only zip (our own export format) back to name + bytes', async () => {
    const entries: ZipEntry[] = [
      { name: 'vocals.flac', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'drums.flac', bytes: new Uint8Array([9, 8, 7]) },
    ];
    const zip = await buildStoreZip(entries);

    const result = await unzip(zip);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'vocals.flac', bytes: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(result[1]).toEqual({ name: 'drums.flac', bytes: new Uint8Array([9, 8, 7]) });
  });

  it('reads a deflated zip, decompressing each entry', async () => {
    const payload = new TextEncoder().encode('x'.repeat(500)); // compresses well
    const zip = await buildDeflateZip([{ name: 'other.wav', bytes: payload }]);

    const result = await unzip(zip);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('other.wav');
    expect(result[0].bytes).toEqual(payload);
  });

  it('supports a mix of STORE and DEFLATE entries in one zip', async () => {
    const stored = new Uint8Array([1, 2, 3]);
    const deflated = new TextEncoder().encode('y'.repeat(300));

    // Build by hand since writeStoreZip is STORE-only: one STORE entry, one DEFLATE entry.
    const compressed = await deflateRaw(deflated);
    const te = new TextEncoder();
    const parts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    // STORE entry
    {
      const nameBytes = te.encode('bass.wav');
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(8, 0, true);
      lv.setUint32(18, stored.length, true);
      lv.setUint32(22, stored.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      parts.push(local, stored);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(10, 0, true); // method: STORE
      cv.setUint32(20, stored.length, true);
      cv.setUint32(24, stored.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + stored.length;
    }

    // DEFLATE entry
    {
      const nameBytes = te.encode('drums.wav');
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(8, 8, true);
      lv.setUint32(18, compressed.length, true);
      lv.setUint32(22, deflated.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      parts.push(local, compressed);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(10, 8, true); // method: DEFLATE
      cv.setUint32(20, compressed.length, true);
      cv.setUint32(24, deflated.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + compressed.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const c of centralParts) { parts.push(c); centralDirSize += c.length; }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 2, true);
    ev.setUint16(10, 2, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);
    parts.push(eocd);

    const total = parts.reduce((n, p) => n + p.length, 0);
    const zip = new Uint8Array(total);
    let woff = 0;
    for (const p of parts) { zip.set(p, woff); woff += p.length; }

    const result = await unzip(zip);
    expect(result.find(e => e.name === 'bass.wav')?.bytes).toEqual(stored);
    expect(result.find(e => e.name === 'drums.wav')?.bytes).toEqual(deflated);
  });

  it('skips directory entries', async () => {
    const zip = await buildStoreZip([{ name: 'folder/', bytes: new Uint8Array(0) }]);
    // writeStoreZip doesn't special-case directories, but a name ending in
    // "/" is the zip convention for one regardless of who wrote it.
    const result = await unzip(zip);
    expect(result).toHaveLength(0);
  });

  it('strips folder paths from entry names, keeping only the basename', async () => {
    const zip = await buildStoreZip([{ name: 'MySong/vocals.flac', bytes: new Uint8Array([1]) }]);
    const result = await unzip(zip);
    expect(result[0].name).toBe('vocals.flac');
  });

  it('throws for bytes with no end-of-central-directory record', async () => {
    await expect(unzip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/end-of-central-directory/);
  });

  it('throws naming the entry for an unsupported compression method', async () => {
    const te = new TextEncoder();
    const nameBytes = te.encode('weird.flac');
    const data = new Uint8Array([1, 2, 3]);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 99, true); // bogus method
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 99, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, 0, true);
    central.set(nameBytes, 46);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length + data.length, true);

    const zip = new Uint8Array(local.length + data.length + central.length + eocd.length);
    let off = 0;
    zip.set(local, off); off += local.length;
    zip.set(data, off); off += data.length;
    zip.set(central, off); off += central.length;
    zip.set(eocd, off);

    await expect(unzip(zip)).rejects.toThrow(/weird\.flac.*unsupported/i);
  });
});
