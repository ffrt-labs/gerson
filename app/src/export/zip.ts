/**
 * STORE-only (uncompressed) ZIP writer for multi-file export (§6.1): the
 * four stems arrive as a zip streamed into showSaveFilePicker on Chromium.
 * Compression buys nothing on already-compressed FLAC/WAV, and STORE is
 * what lets each entry be written straight through to the sink as it's
 * produced — no second, whole-zip-sized buffer held in memory alongside
 * the stems themselves.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** The subset of FileSystemWritableFileStream this module needs. */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_FILE_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0 — the floor that supports plain STORE entries

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields, as ZIP local/central headers require. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const dosYear = Math.max(0, date.getFullYear() - 1980);
  const zdate = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: zdate };
}

/**
 * Write `entries` as a STORE-only zip directly to `sink`, one entry at a
 * time. Each entry's compressed and uncompressed sizes are equal (STORE),
 * so full headers are written up front — no data-descriptor trick needed,
 * since every entry's bytes are already fully in hand.
 */
export async function writeStoreZip(sink: ZipSink, entries: ZipEntry[]): Promise<void> {
  const te = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  let offset = 0;
  const centralHeaders: Uint8Array[] = [];

  for (const entry of entries) {
    const nameBytes = te.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    const localHeaderOffset = offset;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, 0, true); // general purpose flags
    lv.setUint16(8, 0, true); // method: STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    await sink.write(local);
    await sink.write(entry.bytes);
    offset += local.length + entry.bytes.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_FILE_HEADER_SIG, true);
    cv.setUint16(4, VERSION, true); // version made by
    cv.setUint16(6, VERSION, true); // version needed
    cv.setUint16(8, 0, true); // general purpose flags
    cv.setUint16(10, 0, true); // method: STORE
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, localHeaderOffset, true);
    central.set(nameBytes, 46);

    centralHeaders.push(central);
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const header of centralHeaders) {
    await sink.write(header);
    centralDirSize += header.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with central dir start
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // entries total
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true); // comment length

  await sink.write(eocd);
}
