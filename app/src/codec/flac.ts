/**
 * FLAC codec wrapping libflacjs (emscripten build of libFLAC).
 *
 * All encode paths produce native FLAC 16-bit / 44.1 kHz, level 5.
 * All decode paths return transferable Float32Array channels — never an AudioBuffer.
 * Vorbis comments (tags) survive a write→read round-trip.
 */

import wasmUrl from 'libflacjs/dist/libflac.wasm.wasm?url';
import type { VorbisCommentMetadata } from 'libflacjs/dist/index.d';
import type { Flac } from 'libflacjs';

export const SAMPLE_RATE = 44100;
export const BITS_PER_SAMPLE = 16;
export const COMPRESSION_LEVEL = 5;

const METADATA_TYPE_VORBIS_COMMENT = 4;

// ─── Typed façade over the libFLAC raw API ────────────────────────────────────
// libflacjs ships TypeScript types for only the high-level Encoder/Decoder
// utility classes, not for the underlying FLAC__* symbol table that the library
// also exposes. We centralise all casts here so call sites stay clean.
interface LibFlacRaw {
  isReady(): boolean;
  on(event: 'ready' | 'error', handler: (e?: unknown) => void): void;
  create_libflac_encoder(
    sampleRate: number, channels: number, bitsPerSample: number,
    compressionLevel: number, totalSamples?: number, verify?: boolean, blockSize?: number,
  ): number;
  init_encoder_stream(
    id: number,
    writeCb: (data: Uint8Array) => void,
    metadataCb?: () => void,
  ): number;
  FLAC__stream_encoder_process_interleaved(id: number, data: Int32Array, samples: number): boolean;
  FLAC__stream_encoder_finish(id: number): boolean;
  FLAC__stream_encoder_delete(id: number): void;
  create_libflac_decoder(verify: boolean): number;
  FLAC__stream_decoder_set_metadata_respond(id: number, type: number): boolean;
  init_decoder_stream(
    id: number,
    readCb: (bufSize: number) => { buffer: Uint8Array; readDataLength: number; error: boolean },
    writeCb: (channelBuffers: Uint8Array[], frameHeader: FrameHeader) => void,
    errorCb: (err: number, errMsg: string) => void,
    metadataCb: (meta: unknown, block: MetadataBlock) => void,
  ): number;
  FLAC__stream_decoder_process_until_end_of_stream(id: number): boolean;
  FLAC__stream_decoder_finish(id: number): boolean;
  FLAC__stream_decoder_delete(id: number): void;
}

interface FrameHeader {
  bitsPerSample: number;
  channels: number;
  sampleRate: number;
}

interface MetadataBlock {
  type: number;
  data?: unknown;
}

function asRaw(flac: Flac): LibFlacRaw {
  return flac as unknown as LibFlacRaw;
}

// ─── Lazy singleton initialisation ───────────────────────────────────────────

// libflacjs ships two builds of libFLAC side by side: `libflac.js`, which is
// wasm2js — the wasm transpiled *back* to plain JavaScript — and
// `libflac.wasm.js`, the real thing. They are indistinguishable by name and
// the wasm2js one is the shorter import, which is how it got picked. One
// whole-stem process_interleaved took ≥14.5 minutes at 100% CPU in Chrome
// under wasm2js, against 557 ms on the wasm build. Four Stems: a ~2.4 s tail.
//
// The .wasm sidecar is resolved by the bundler rather than by hand: `?url`
// makes it a build input, so a libflacjs bump changes the content hash and
// this URL together. A copy maintained by hand under public/ can drift from
// the JS that loads it with no build-time signal at all.
//
// FLAC_SCRIPT_LOCATION is libflacjs's own hook into emscripten's locateFile,
// and it is read while the module body runs — hence the dynamic import
// below, which is the only way to set it first. In Node (the test suite)
// emscripten resolves the sidecar itself and the global goes unread.
async function loadFlac(): Promise<LibFlacRaw> {
  (globalThis as { FLAC_SCRIPT_LOCATION?: Record<string, string> }).FLAC_SCRIPT_LOCATION = {
    'libflac.wasm.wasm': wasmUrl,
  };

  const mod = await import('libflacjs/dist/libflac.wasm.js');
  // Under ESM interop the namespace may wrap the real export in `default`.
  const flac = (mod as unknown as { default?: Flac }).default ?? (mod as unknown as Flac);
  const raw = asRaw(flac);

  if (raw.isReady()) return raw;
  return new Promise<LibFlacRaw>((resolve, reject) => {
    raw.on('ready', () => resolve(raw));
    raw.on('error', (e) => reject(new Error(`libflacjs failed to initialise: ${String(e)}`)));
  });
}

let _flacPromise: Promise<LibFlacRaw> | null = null;

function getFlac(): Promise<LibFlacRaw> {
  _flacPromise ??= loadFlac();
  return _flacPromise;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function writeUint32LE(view: DataView, byteOffset: number, value: number): void {
  view.setUint32(byteOffset, value, /* LE */ true);
}

function readUint24BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
}

// libflacjs v5.6.0 (libFLAC 1.3.4) does not expose FLAC__metadata_object_new
// or FLAC__stream_encoder_set_metadata through its JavaScript API — only the
// internal high-level Encoder utility class and the raw FLAC__* symbol table
// are surfaced. The raw API accepts only pre-allocated C-struct pointers, which
// requires allocating the struct layout in the WASM heap manually. We instead
// post-process the encoded bitstream and splice in a hand-built VORBIS_COMMENT
// metadata block, which is safe because:
//   (a) the FLAC spec allows VORBIS_COMMENT to appear after STREAMINFO in any
//       metadata block position, and
//   (b) we confirm the round-trip in the automated test suite.

function buildVorbisCommentBlock(tags: Record<string, string>, isLast: boolean): Uint8Array {
  const te = new TextEncoder();
  const vendor = te.encode('libFLAC 1.3.4 20220220');
  const entries = Object.entries(tags).map(([k, v]) => te.encode(`${k.toUpperCase()}=${v}`));

  let dataLen = 4 + vendor.length + 4;
  for (const e of entries) dataLen += 4 + e.length;

  const block = new Uint8Array(4 + dataLen);
  const view = new DataView(block.buffer);

  block[0] = ((isLast ? 1 : 0) << 7) | METADATA_TYPE_VORBIS_COMMENT;
  block[1] = (dataLen >> 16) & 0xff;
  block[2] = (dataLen >> 8) & 0xff;
  block[3] = dataLen & 0xff;

  let off = 4;
  writeUint32LE(view, off, vendor.length); off += 4;
  block.set(vendor, off); off += vendor.length;
  writeUint32LE(view, off, entries.length); off += 4;
  for (const e of entries) {
    writeUint32LE(view, off, e.length); off += 4;
    block.set(e, off); off += e.length;
  }

  return block;
}

// Any existing VORBIS_COMMENT block is dropped rather than left in place —
// re-tagging an already-tagged file (as export does with a stem carrying
// storage-internal tags) must not leave two comment blocks behind, since
// nothing in the FLAC spec resolves that ambiguity for a reader.
function injectVorbisComments(flacBytes: Uint8Array, tags: Record<string, string>): Uint8Array {
  if (Object.keys(tags).length === 0) return flacBytes;

  const keptBlocks: Array<{ start: number; end: number }> = [];
  let off = 4; // skip "fLaC"
  let audioStart = flacBytes.length;

  while (off + 4 <= flacBytes.length) {
    const headerByte = flacBytes[off];
    const blockType = headerByte & 0x7f;
    const dataLen = readUint24BE(flacBytes, off + 1);
    const isLast = (headerByte & 0x80) !== 0;

    if (blockType > 6) { audioStart = off; break; } // guard against audio frame territory

    const blockEnd = off + 4 + dataLen;
    if (blockType !== METADATA_TYPE_VORBIS_COMMENT) keptBlocks.push({ start: off, end: blockEnd });

    audioStart = blockEnd;
    if (isLast) break;
    off = blockEnd;
  }

  const commentBlock = buildVorbisCommentBlock(tags, true);
  const keptLen = keptBlocks.reduce((n, b) => n + (b.end - b.start), 0);
  const result = new Uint8Array(4 + keptLen + commentBlock.length + (flacBytes.length - audioStart));

  result.set(flacBytes.subarray(0, 4), 0); // "fLaC"
  let woff = 4;
  for (const b of keptBlocks) {
    result.set(flacBytes.subarray(b.start, b.end), woff);
    result[woff] = result[woff] & 0x7f; // clear is_last — the comment block below is now last
    woff += b.end - b.start;
  }
  result.set(commentBlock, woff);
  woff += commentBlock.length;
  result.set(flacBytes.subarray(audioStart), woff);

  return result;
}

// Cheap signature check — no WASM boot required, unlike decodeFlac.
export function isFlacFile(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43; // "fLaC"
}

function parseVorbisCommentBlock(
  bytes: Uint8Array, view: DataView, start: number, end: number, tags: Record<string, string>,
): void {
  let p = start;
  if (p + 4 > end) return;
  const vendorLen = view.getUint32(p, true);
  p += 4 + vendorLen;
  if (p + 4 > end) return;
  const count = view.getUint32(p, true);
  p += 4;

  const td = new TextDecoder();
  for (let i = 0; i < count && p + 4 <= end; i++) {
    const len = view.getUint32(p, true);
    p += 4;
    if (p + len > end) break;
    const comment = td.decode(bytes.subarray(p, p + len));
    p += len;
    const eq = comment.indexOf('=');
    if (eq > 0) tags[comment.slice(0, eq).toUpperCase()] = comment.slice(eq + 1);
  }
}

/**
 * Reads a FLAC file's Vorbis comment tags directly from its metadata
 * blocks, without decoding any audio frames or booting the WASM decoder.
 * Import (§6.2) uses this to check identity/role tags before paying for a
 * full decode — "identity is checked before any work". Returns an empty
 * object for a non-FLAC file or one with no comment block, never throws.
 */
export function readVorbisComments(flacBytes: Uint8Array): VorbisTags {
  const tags: VorbisTags = {};
  if (!isFlacFile(flacBytes)) return tags;

  const view = new DataView(flacBytes.buffer, flacBytes.byteOffset, flacBytes.byteLength);
  let off = 4; // skip "fLaC"

  while (off + 4 <= flacBytes.length) {
    const headerByte = flacBytes[off];
    const blockType = headerByte & 0x7f;
    const dataLen = readUint24BE(flacBytes, off + 1);
    const isLast = (headerByte & 0x80) !== 0;
    const blockStart = off + 4;
    const blockEnd = blockStart + dataLen;
    if (blockType > 6 || blockEnd > flacBytes.length) break; // guard against malformed/audio territory

    if (blockType === METADATA_TYPE_VORBIS_COMMENT) {
      parseVorbisCommentBlock(flacBytes, view, blockStart, blockEnd, tags);
    }

    if (isLast) break;
    off = blockEnd;
  }

  return tags;
}

function pcmToInt32Interleaved(channels: Float32Array[]): Int32Array {
  const numCh = channels.length;
  const numSamples = channels[0].length;
  const out = new Int32Array(numSamples * numCh);
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.round(channels[ch][i] * 32767);
      out[i * numCh + ch] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
  }
  return out;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type VorbisTags = Record<string, string>;

export interface DecodeResult {
  /** Per-channel PCM in [-1, 1]. Each Float32Array owns a fresh transferable ArrayBuffer. */
  channels: Float32Array[];
  sampleRate: number;
  bitsPerSample: number;
  tags: VorbisTags;
}

export interface FlacEncoder {
  /** Feed one chunk of per-channel samples. Call as many times as needed. */
  push(channels: Float32Array[]): void;
  /** Finalise encoding. Returns the complete FLAC file (with tags injected). */
  finish(): Uint8Array;
}

// ─── Encode ───────────────────────────────────────────────────────────────────

/**
 * Create a streaming FLAC encoder.
 *
 * @param numChannels  Number of audio channels (2 for stereo).
 * @param sampleRate   Sample rate in Hz (default 44100).
 * @param tags         Vorbis comment tags to embed (written on finish()).
 */
export async function createEncoder(
  numChannels: number,
  sampleRate = SAMPLE_RATE,
  tags: VorbisTags = {}
): Promise<FlacEncoder> {
  const flac = await getFlac();

  const encoderId = flac.create_libflac_encoder(
    sampleRate, numChannels, BITS_PER_SAMPLE, COMPRESSION_LEVEL,
  );
  if (encoderId === 0) throw new Error('libflacjs: create_libflac_encoder returned 0');

  const chunks: Uint8Array[] = [];

  const initStatus = flac.init_encoder_stream(
    encoderId,
    (data) => { chunks.push(data.slice()); },
  );
  if (initStatus !== 0) {
    throw new Error(`libflacjs: init_encoder_stream returned status ${initStatus}`);
  }

  return {
    push(channels: Float32Array[]): void {
      const numSamples = channels[0].length;
      const interleaved = pcmToInt32Interleaved(channels);
      const ok = flac.FLAC__stream_encoder_process_interleaved(encoderId, interleaved, numSamples);
      if (!ok) throw new Error('libflacjs: encoder_process_interleaved failed');
    },

    finish(): Uint8Array {
      flac.FLAC__stream_encoder_finish(encoderId);
      flac.FLAC__stream_encoder_delete(encoderId);

      const totalLen = chunks.reduce((n, c) => n + c.length, 0);
      const flacBytes = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) { flacBytes.set(c, off); off += c.length; }

      return injectVorbisComments(flacBytes, tags);
    },
  };
}

/**
 * Rewrite an already-encoded FLAC file's Vorbis comments, replacing any that
 * are already present. Operates on the compressed bitstream directly — no
 * decode/re-encode — so re-tagging a stored stem for export costs a splice,
 * not a full PCM round-trip.
 */
export function tagFlac(flacBytes: Uint8Array, tags: VorbisTags): Uint8Array {
  return injectVorbisComments(flacBytes, tags);
}

/**
 * Encode per-channel Float32 PCM to a complete FLAC file in one call.
 */
export async function encodePcm(
  channels: Float32Array[],
  sampleRate = SAMPLE_RATE,
  tags: VorbisTags = {}
): Promise<Uint8Array> {
  const encoder = await createEncoder(channels.length, sampleRate, tags);
  encoder.push(channels);
  return encoder.finish();
}

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Decode FLAC bytes to per-channel Float32 PCM.
 * The returned Float32Arrays own fresh ArrayBuffers and are transferable.
 * No AudioBuffer is created.
 */
export async function decodeFlac(flacBytes: Uint8Array): Promise<DecodeResult> {
  const flac = await getFlac();

  const decoderId = flac.create_libflac_decoder(false);
  if (decoderId === 0) throw new Error('libflacjs: create_libflac_decoder returned 0');

  flac.FLAC__stream_decoder_set_metadata_respond(decoderId, METADATA_TYPE_VORBIS_COMMENT);

  let readOffset = 0;
  const pcmBlocks: Uint8Array[][] = [];
  let detectedSampleRate = SAMPLE_RATE;
  let detectedBitsPerSample = BITS_PER_SAMPLE;
  const tags: VorbisTags = {};
  let decodeError: Error | null = null;

  const initStatus = flac.init_decoder_stream(
    decoderId,
    (bufSize) => {
      if (readOffset >= flacBytes.length) {
        return { buffer: new Uint8Array(0), readDataLength: 0, error: false };
      }
      const end = Math.min(readOffset + bufSize, flacBytes.length);
      const buffer = flacBytes.subarray(readOffset, end);
      const readDataLength = end - readOffset;
      readOffset = end;
      return { buffer, readDataLength, error: false };
    },
    (channelBuffers, frameHeader) => {
      detectedSampleRate = frameHeader.sampleRate;
      detectedBitsPerSample = frameHeader.bitsPerSample;
      pcmBlocks.push(channelBuffers.map((b) => b.slice()));
    },
    (err, errMsg) => {
      decodeError = new Error(`libflacjs decode error ${err}: ${errMsg}`);
    },
    (_, block) => {
      if (block.type === METADATA_TYPE_VORBIS_COMMENT) {
        const vc = block.data as VorbisCommentMetadata | undefined;
        if (vc?.comments) {
          for (const comment of vc.comments) {
            const eq = comment.indexOf('=');
            if (eq > 0) {
              tags[comment.slice(0, eq).toUpperCase()] = comment.slice(eq + 1);
            }
          }
        }
      }
    },
  );

  if (initStatus !== 0) {
    flac.FLAC__stream_decoder_delete(decoderId);
    throw new Error(`libflacjs: init_decoder_stream returned status ${initStatus}`);
  }

  flac.FLAC__stream_decoder_process_until_end_of_stream(decoderId);
  flac.FLAC__stream_decoder_finish(decoderId);
  flac.FLAC__stream_decoder_delete(decoderId);

  if (decodeError) throw decodeError;
  if (pcmBlocks.length === 0) throw new Error('libflacjs: decoded zero frames');

  const numChannels = pcmBlocks[0].length;
  const bytesPerSample = detectedBitsPerSample / 8;
  const channels: Float32Array[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const totalBytes = pcmBlocks.reduce((n, block) => n + block[ch].length, 0);
    const numSamples = totalBytes / bytesPerSample;
    const float32 = new Float32Array(numSamples);
    let sampleIdx = 0;

    for (const block of pcmBlocks) {
      const raw = block[ch];
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const blockSamples = raw.length / bytesPerSample;

      for (let i = 0; i < blockSamples; i++) {
        float32[sampleIdx++] = view.getInt16(i * bytesPerSample, /* LE */ true) / 32768;
      }
    }

    channels.push(float32);
  }

  return { channels, sampleRate: detectedSampleRate, bitsPerSample: detectedBitsPerSample, tags };
}
