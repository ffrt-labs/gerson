/**
 * Canonical 16-bit PCM WAV encoder — the visible export alternative to FLAC
 * (§6.1). WAV carries no tag block a decoder respects, so unlike tagFlac
 * there is nothing to write beyond the audio itself.
 *
 * decodeWav is import's (§6.2) counterpart: WAV is the untagged escape
 * hatch (our own export, Demucs CLI, Spleeter, downloaded packs all use
 * it), so import needs to read it back without going through the browser's
 * decodeAudioData — that path is what §7.1 reserves for formats we have no
 * parser for.
 */

const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const HEADER_BYTES = 44;

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function quantise(sample: number): number {
  const s = Math.round(sample * 32767);
  return s < -32768 ? -32768 : s > 32767 ? 32767 : s;
}

/** Encode per-channel Float32 PCM in [-1, 1] to a complete canonical WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  const numSamples = channels[0]?.length ?? 0;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataSize = numSamples * blockAlign;

  const bytes = new Uint8Array(HEADER_BYTES + dataSize);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(offset, quantise(channels[ch][i]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return bytes;
}

// Cheap signature check — no parsing required, unlike decodeWav.
export function isWavFile(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE';
}

export interface DecodedWav {
  /** Per-channel PCM in [-1, 1]. */
  channels: Float32Array[];
  sampleRate: number;
}

// One reader per bit depth, each returning [-1, 1]. 32-bit float PCM (format
// 3) is deliberately not supported — none of import's source tools (our own
// exporter, Demucs CLI, Spleeter) produce it, and guessing wrong on sample
// interpretation is worse than refusing.
function sampleReader(view: DataView, bitsPerSample: number): (byteOffset: number) => number {
  switch (bitsPerSample) {
    case 8:
      return (o) => (view.getUint8(o) - 128) / 128;
    case 16:
      return (o) => view.getInt16(o, true) / 32768;
    case 24:
      return (o) => {
        const raw = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        const signed = raw & 0x800000 ? raw - 0x1000000 : raw;
        return signed / 8388608;
      };
    case 32:
      return (o) => view.getInt32(o, true) / 2147483648;
    default:
      throw new Error(`Unsupported WAV bit depth (${bitsPerSample}-bit).`);
  }
}

/**
 * Decode a canonical PCM WAV file to per-channel Float32 PCM. Walks chunks
 * generically (skipping anything but "fmt " and "data") since third-party
 * WAV files routinely carry extra chunks (LIST, fact, …) ahead of the audio.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('Not a WAV file (missing RIFF/WAVE header).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let fmt: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataStart = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(bodyStart, true),
        numChannels: view.getUint16(bodyStart + 2, true),
        sampleRate: view.getUint32(bodyStart + 4, true),
        bitsPerSample: view.getUint16(bodyStart + 14, true),
      };
    } else if (chunkId === 'data') {
      dataStart = bodyStart;
      dataSize = chunkSize;
    }

    // Chunks are word-aligned: an odd-sized body is followed by a pad byte
    // not counted in chunkSize.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) throw new Error('WAV file has no fmt chunk.');
  if (dataStart === -1) throw new Error('WAV file has no data chunk.');
  if (fmt.audioFormat !== WAVE_FORMAT_PCM && fmt.audioFormat !== WAVE_FORMAT_EXTENSIBLE) {
    throw new Error(`Unsupported WAV audio format (${fmt.audioFormat}) — only PCM is supported.`);
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const numChannels = fmt.numChannels;
  const numSamples = Math.floor(dataSize / bytesPerSample / numChannels);
  const readSample = sampleReader(view, fmt.bitsPerSample);

  const channels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(numSamples));
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = readSample(dataStart + (i * numChannels + ch) * bytesPerSample);
    }
  }

  return { channels, sampleRate: fmt.sampleRate };
}
