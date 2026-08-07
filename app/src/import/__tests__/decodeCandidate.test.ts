import { describe, it, expect, vi } from 'vitest';
import { decodeCandidate, type DecodedCandidate, type DecodeCandidateDeps } from '../decodeCandidate.ts';
import { encodePcm, SAMPLE_RATE } from '../../codec/flac.ts';
import { encodeWav } from '../../codec/wav.ts';
import { DecodeError } from '../../intake/decode.ts';

function makeStereoFixture(samples = 256, freqL = 440, freqR = 880): Float32Array[] {
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    left[i] = Math.sin((2 * Math.PI * freqL * i) / SAMPLE_RATE);
    right[i] = Math.sin((2 * Math.PI * freqR * i) / SAMPLE_RATE);
  }
  return [left, right];
}

function throwingDeps(): DecodeCandidateDeps {
  return {
    decodeViaBrowser: vi.fn(async () => {
      throw new Error('decodeViaBrowser should not be called for a native 44100 file');
    }),
  };
}

describe('decodeCandidate', () => {
  describe('FLAC — native decode', () => {
    it('decodes a 44100 Hz FLAC without touching the browser fallback', async () => {
      const flacBytes = await encodePcm(makeStereoFixture(256));
      const result = await decodeCandidate(flacBytes, throwingDeps());

      expect(result.left).toHaveLength(256);
      expect(result.right).toHaveLength(256);
      expect(result.durationSec).toBeCloseTo(256 / SAMPLE_RATE, 6);
    });

    it('duplicates the single channel to both L/R for mono FLAC', async () => {
      const mono = [new Float32Array([0.1, 0.2, 0.3])];
      const flacBytes = await encodePcm(mono);
      const result = await decodeCandidate(flacBytes, throwingDeps());

      expect(result.left).toEqual(result.right);
    });

    it('falls back to the browser decoder when the FLAC sample rate is not 44100', async () => {
      const flacBytes = await encodePcm(makeStereoFixture(64), 48000);
      const fallback: DecodedCandidate = { left: new Float32Array([9]), right: new Float32Array([9]), durationSec: 1 };
      const decodeViaBrowser = vi.fn(async () => fallback);

      const result = await decodeCandidate(flacBytes, { decodeViaBrowser });

      expect(decodeViaBrowser).toHaveBeenCalledTimes(1);
      expect(result).toBe(fallback);
    });

    it('falls back to the browser decoder for a corrupt FLAC (magic present, data garbage)', async () => {
      const flacBytes = await encodePcm(makeStereoFixture(64));
      const corrupt = flacBytes.slice(0, 20); // truncated — magic intact, stream isn't
      const fallback: DecodedCandidate = { left: new Float32Array([1]), right: new Float32Array([1]), durationSec: 1 };
      const decodeViaBrowser = vi.fn(async () => fallback);

      const result = await decodeCandidate(corrupt, { decodeViaBrowser });

      expect(decodeViaBrowser).toHaveBeenCalledTimes(1);
      expect(result).toBe(fallback);
    });
  });

  describe('WAV — native decode', () => {
    it('decodes a 44100 Hz WAV without touching the browser fallback', async () => {
      const wavBytes = encodeWav(makeStereoFixture(128), SAMPLE_RATE);
      const result = await decodeCandidate(wavBytes, throwingDeps());

      expect(result.left).toHaveLength(128);
      expect(result.durationSec).toBeCloseTo(128 / SAMPLE_RATE, 6);
    });

    it('duplicates the single channel to both L/R for mono WAV', async () => {
      const wavBytes = encodeWav([new Float32Array([0.5, -0.5])], SAMPLE_RATE);
      const result = await decodeCandidate(wavBytes, throwingDeps());

      expect(result.left).toEqual(result.right);
    });

    it('falls back to the browser decoder when the WAV sample rate is not 44100', async () => {
      const wavBytes = encodeWav(makeStereoFixture(64), 48000);
      const fallback: DecodedCandidate = { left: new Float32Array([9]), right: new Float32Array([9]), durationSec: 1 };
      const decodeViaBrowser = vi.fn(async () => fallback);

      const result = await decodeCandidate(wavBytes, { decodeViaBrowser });

      expect(decodeViaBrowser).toHaveBeenCalledTimes(1);
      expect(result).toBe(fallback);
    });
  });

  describe('unrecognised formats', () => {
    it('goes straight to the browser decoder for bytes matching neither signature', async () => {
      const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]); // MP3-ish, not FLAC/WAV
      const fallback: DecodedCandidate = { left: new Float32Array([1]), right: new Float32Array([1]), durationSec: 1 };
      const decodeViaBrowser = vi.fn(async () => fallback);

      const result = await decodeCandidate(bytes, { decodeViaBrowser });

      expect(decodeViaBrowser).toHaveBeenCalledTimes(1);
      expect(result).toBe(fallback);
    });

    it('propagates a DecodeError from the browser fallback', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const decodeViaBrowser = vi.fn(async () => { throw new DecodeError('Firefox'); });

      await expect(decodeCandidate(bytes, { decodeViaBrowser })).rejects.toBeInstanceOf(DecodeError);
    });
  });
});
