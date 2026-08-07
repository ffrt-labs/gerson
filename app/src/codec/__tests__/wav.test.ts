import { describe, it, expect } from 'vitest';
import { encodeWav, decodeWav } from '../wav.ts';

const SAMPLE_RATE = 44100;

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function makeStereoFixture(samples = 512): Float32Array[] {
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    right[i] = Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE) * 0.5;
  }
  return [left, right];
}

describe('encodeWav', () => {
  it('writes a canonical 44-byte RIFF/WAVE/fmt/data header', () => {
    const bytes = encodeWav(makeStereoFixture(4), SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(readAscii(bytes, 0, 4)).toBe('RIFF');
    expect(readAscii(bytes, 8, 4)).toBe('WAVE');
    expect(readAscii(bytes, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size (PCM)
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readAscii(bytes, 36, 4)).toBe('data');
  });

  it('reports RIFF and data chunk sizes consistent with the payload', () => {
    const samples = 512;
    const bytes = encodeWav(makeStereoFixture(samples), SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const dataSize = samples * 2 /* channels */ * 2 /* bytes/sample */;
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(bytes.length).toBe(44 + dataSize);
  });

  it('interleaves channels as little-endian 16-bit PCM, in [-32768, 32767]', () => {
    const bytes = encodeWav(makeStereoFixture(4), SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Sample 0: left = sin(0) = 0, right = sin(0)*0.5 = 0.
    expect(view.getInt16(44 + 0, true)).toBe(0);
    expect(view.getInt16(44 + 2, true)).toBe(0);
  });

  it('clamps out-of-range samples instead of wrapping', () => {
    const bytes = encodeWav([new Float32Array([2, -2]), new Float32Array([2, -2])], SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getInt16(44 + 0, true)).toBe(32767);
    expect(view.getInt16(44 + 4, true)).toBe(-32768);
  });

  it('supports mono', () => {
    const mono = [new Float32Array([0.5, -0.5])];
    const bytes = encodeWav(mono, SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(40, true)).toBe(2 * 2); // 2 samples * 2 bytes
  });
});

describe('decodeWav', () => {
  it('round-trips encodeWav output — bit-exact after 16-bit quantisation', () => {
    const original = makeStereoFixture(256);
    const bytes = encodeWav(original, SAMPLE_RATE);
    const { channels, sampleRate } = decodeWav(bytes);

    expect(sampleRate).toBe(SAMPLE_RATE);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(256);

    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < 256; i++) {
        const quantised = Math.round(original[ch][i] * 32767) / 32768;
        expect(channels[ch][i]).toBeCloseTo(quantised, 4);
      }
    }
  });

  it('supports mono', () => {
    const bytes = encodeWav([new Float32Array([0.5, -0.5])], SAMPLE_RATE);
    const { channels } = decodeWav(bytes);
    expect(channels).toHaveLength(1);
    expect(channels[0][0]).toBeCloseTo(0.5, 3);
    expect(channels[0][1]).toBeCloseTo(-0.5, 3);
  });

  it('skips unrecognised chunks (e.g. LIST) ahead of data', () => {
    const audio = encodeWav(makeStereoFixture(8), SAMPLE_RATE);
    const header = audio.subarray(0, 12);
    const fmtChunk = audio.subarray(12, 36); // "fmt " + size(16) + 16 bytes body
    const dataChunk = audio.subarray(36); // "data" + size + payload

    const listBody = new Uint8Array([1, 2, 3]); // odd length, exercises padding
    const listChunk = new Uint8Array(8 + listBody.length + 1);
    const lv = new DataView(listChunk.buffer);
    listChunk.set(new TextEncoder().encode('LIST'), 0);
    lv.setUint32(4, listBody.length, true);
    listChunk.set(listBody, 8);
    // trailing pad byte left as 0

    const withList = new Uint8Array(header.length + fmtChunk.length + listChunk.length + dataChunk.length);
    withList.set(header, 0);
    withList.set(fmtChunk, header.length);
    withList.set(listChunk, header.length + fmtChunk.length);
    withList.set(dataChunk, header.length + fmtChunk.length + listChunk.length);
    // Fix up the RIFF size field for the extra bytes.
    new DataView(withList.buffer).setUint32(4, withList.length - 8, true);

    const { channels } = decodeWav(withList);
    expect(channels[0]).toHaveLength(8);
  });

  it('throws for bytes with no RIFF/WAVE header', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/RIFF\/WAVE/);
  });

  it('throws for a non-PCM audio format', () => {
    const bytes = encodeWav(makeStereoFixture(4), SAMPLE_RATE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(20, 3, true); // IEEE float — not supported
    expect(() => decodeWav(bytes)).toThrow(/Unsupported WAV audio format/);
  });

  it('decodes 8-bit and 24-bit PCM', () => {
    // Hand-build minimal mono WAV files at other bit depths.
    function buildWav(bitsPerSample: number, samples: number[]): Uint8Array {
      const bytesPerSample = bitsPerSample / 8;
      const dataSize = samples.length * bytesPerSample;
      const bytes = new Uint8Array(44 + dataSize);
      const view = new DataView(bytes.buffer);
      bytes.set(new TextEncoder().encode('RIFF'), 0);
      view.setUint32(4, 36 + dataSize, true);
      bytes.set(new TextEncoder().encode('WAVE'), 8);
      bytes.set(new TextEncoder().encode('fmt '), 12);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, SAMPLE_RATE, true);
      view.setUint32(28, SAMPLE_RATE * bytesPerSample, true);
      view.setUint16(32, bytesPerSample, true);
      view.setUint16(34, bitsPerSample, true);
      bytes.set(new TextEncoder().encode('data'), 36);
      view.setUint32(40, dataSize, true);
      let off = 44;
      for (const s of samples) {
        if (bitsPerSample === 8) {
          view.setUint8(off, s);
        } else if (bitsPerSample === 24) {
          view.setUint8(off, s & 0xff);
          view.setUint8(off + 1, (s >> 8) & 0xff);
          view.setUint8(off + 2, (s >> 16) & 0xff);
        }
        off += bytesPerSample;
      }
      return bytes;
    }

    const eightBit = buildWav(8, [0, 128, 255]);
    const { channels: eightBitChannels } = decodeWav(eightBit);
    expect(eightBitChannels[0][0]).toBeCloseTo(-1, 2);
    expect(eightBitChannels[0][1]).toBeCloseTo(0, 2);
    expect(eightBitChannels[0][2]).toBeCloseTo(0.99, 2);

    const twentyFourBit = buildWav(24, [0, 8388607, -8388608 + 0x1000000]);
    const { channels: tfChannels } = decodeWav(twentyFourBit);
    expect(tfChannels[0][0]).toBeCloseTo(0, 4);
    expect(tfChannels[0][1]).toBeCloseTo(1, 4);
  });
});
