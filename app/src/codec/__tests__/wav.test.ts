import { describe, it, expect } from 'vitest';
import { encodeWav } from '../wav.ts';

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
