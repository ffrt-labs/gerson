/**
 * Canonical 16-bit PCM WAV encoder — the visible export alternative to FLAC
 * (§6.1). WAV carries no tag block a decoder respects, so unlike tagFlac
 * there is nothing to write beyond the audio itself.
 */

const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
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
