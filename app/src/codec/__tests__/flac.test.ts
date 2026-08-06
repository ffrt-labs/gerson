import { describe, it, expect } from 'vitest';
import {
  encodePcm,
  decodeFlac,
  createEncoder,
  tagFlac,
  SAMPLE_RATE,
  BITS_PER_SAMPLE,
  COMPRESSION_LEVEL,
} from '../flac.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STEREO_CHANNELS = 2;
const FIXTURE_SAMPLES = 4096; // ~93 ms at 44100 Hz

/** Generate a deterministic stereo sine fixture. */
function makeSineFixture(samples = FIXTURE_SAMPLES): Float32Array[] {
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    right[i] = Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE);
  }
  return [left, right];
}

/** Round-trip encode then decode; return the decoded channels. */
async function roundTrip(
  channels: Float32Array[],
  tags: Record<string, string> = {},
): Promise<{ channels: Float32Array[]; tags: Record<string, string> }> {
  const flacBytes = await encodePcm(channels, SAMPLE_RATE, tags);
  const result = await decodeFlac(flacBytes);
  return { channels: result.channels, tags: result.tags };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FLAC codec', () => {
  describe('encode / decode round-trip', () => {
    it('is bit-exact for 16-bit 44.1 kHz stereo', async () => {
      const original = makeSineFixture();

      // Re-quantise to 16-bit so our comparison is meaningful.
      const quantised = original.map((ch) =>
        Float32Array.from(ch, (s) => {
          const q = Math.round(s * 32767);
          const clamped = q < -32768 ? -32768 : q > 32767 ? 32767 : q;
          return clamped / 32768;
        }),
      );

      const { channels: decoded } = await roundTrip(original);

      expect(decoded).toHaveLength(STEREO_CHANNELS);
      expect(decoded[0]).toHaveLength(quantised[0].length);

      for (let ch = 0; ch < STEREO_CHANNELS; ch++) {
        for (let i = 0; i < quantised[ch].length; i++) {
          // Allow ±1 LSB of rounding error from the Float32→Int32→Float32 path.
          expect(Math.abs(decoded[ch][i] - quantised[ch][i])).toBeLessThanOrEqual(
            1 / 32768,
          );
        }
      }
    });
  });

  describe('decode output type', () => {
    it('returns Float32Array channels — never an AudioBuffer', async () => {
      const flacBytes = await encodePcm(makeSineFixture());
      const { channels } = await decodeFlac(flacBytes);

      expect(channels).toHaveLength(STEREO_CHANNELS);
      for (const ch of channels) {
        expect(ch).toBeInstanceOf(Float32Array);
      }
    });

    it('each channel owns a fresh ArrayBuffer (transferable)', async () => {
      const flacBytes = await encodePcm(makeSineFixture());
      const { channels } = await decodeFlac(flacBytes);

      // ArrayBuffers must be distinct objects.
      const buffers = channels.map((ch) => ch.buffer);
      const unique = new Set(buffers);
      expect(unique.size).toBe(channels.length);

      // Confirm actual transferability: structuredClone with transfer detaches the
      // buffer; if detach throws the buffer is not transferable.
      for (const ch of channels) {
        const clone = structuredClone(ch, { transfer: [ch.buffer] });
        expect(clone).toBeInstanceOf(Float32Array);
        expect(ch.buffer.byteLength).toBe(0); // detached
      }
    });

    it('source Uint8Array buffer is not retained in the output', async () => {
      const flacBytes = await encodePcm(makeSineFixture());
      const inputBuffer = flacBytes.buffer;
      const { channels } = await decodeFlac(flacBytes);

      for (const ch of channels) {
        expect(ch.buffer).not.toBe(inputBuffer);
      }
    });
  });

  describe('Vorbis comments', () => {
    it('survive a write → read round-trip', async () => {
      const tags = { TITLE: 'Test Song', ARTIST: 'Gerson Tests', ALBUM: 'Codec Suite' };
      const { tags: decoded } = await roundTrip(makeSineFixture(), tags);

      expect(decoded['TITLE']).toBe('Test Song');
      expect(decoded['ARTIST']).toBe('Gerson Tests');
      expect(decoded['ALBUM']).toBe('Codec Suite');
    });

    it('keys are normalised to uppercase on read', async () => {
      const { tags } = await roundTrip(makeSineFixture(), { title: 'lower', mixedCase: 'value' });
      expect(tags['TITLE']).toBe('lower');
      expect(tags['MIXEDCASE']).toBe('value');
    });

    it('returns empty tags when none were written', async () => {
      const { tags } = await roundTrip(makeSineFixture());
      expect(Object.keys(tags)).toHaveLength(0);
    });
  });

  describe('tagFlac (re-tagging an already-encoded file)', () => {
    it('overwrites tags already present rather than appending a second block', async () => {
      const original = await encodePcm(makeSineFixture(), SAMPLE_RATE, { ROLE: 'VOCALS', ID: 'abc' });
      const retagged = tagFlac(original, { ROLE: 'vocals', SONG_ID: 'abc', SCHEMA_VERSION: '1', TITLE: 'My Song' });

      const { tags } = await decodeFlac(retagged);

      expect(tags['ROLE']).toBe('vocals');
      expect(tags['SONG_ID']).toBe('abc');
      expect(tags['SCHEMA_VERSION']).toBe('1');
      expect(tags['TITLE']).toBe('My Song');
      // The old ID tag must not survive — a leftover second comment block
      // would otherwise leak it back in.
      expect(tags['ID']).toBeUndefined();
    });

    it('decodes to the same audio as before re-tagging', async () => {
      const original = await encodePcm(makeSineFixture(), SAMPLE_RATE, { ROLE: 'DRUMS', ID: 'xyz' });
      const { channels: before } = await decodeFlac(original);

      const retagged = tagFlac(original, { ROLE: 'drums' });
      const { channels: after } = await decodeFlac(retagged);

      expect(after).toHaveLength(before.length);
      for (let ch = 0; ch < before.length; ch++) {
        expect(after[ch].length).toBe(before[ch].length);
        for (let i = 0; i < before[ch].length; i++) {
          expect(after[ch][i]).toBe(before[ch][i]);
        }
      }
    });

    it('tags a file that had no prior comment block', async () => {
      const untagged = await encodePcm(makeSineFixture());
      const tagged = tagFlac(untagged, { ROLE: 'other' });

      const { tags } = await decodeFlac(tagged);
      expect(tags['ROLE']).toBe('other');
    });
  });

  describe('streaming encode', () => {
    it('produces the same output as encodePcm when fed in equal-size chunks', async () => {
      const channels = makeSineFixture(FIXTURE_SAMPLES);

      // Streaming: split into 4 equal chunks.
      const CHUNKS = 4;
      const chunkSize = FIXTURE_SAMPLES / CHUNKS;
      const encoder = await createEncoder(STEREO_CHANNELS, SAMPLE_RATE);
      for (let i = 0; i < CHUNKS; i++) {
        const start = i * chunkSize;
        encoder.push(channels.map((ch) => ch.subarray(start, start + chunkSize) as Float32Array));
      }
      const streamingFlac = encoder.finish();

      // Batch encode for comparison.
      const batchFlac = await encodePcm(channels);

      // Decode both and compare samples.
      const { channels: streamDecoded } = await decodeFlac(streamingFlac);
      const { channels: batchDecoded } = await decodeFlac(batchFlac);

      expect(streamDecoded[0].length).toBe(batchDecoded[0].length);
      for (let ch = 0; ch < STEREO_CHANNELS; ch++) {
        for (let i = 0; i < streamDecoded[ch].length; i++) {
          expect(streamDecoded[ch][i]).toBe(batchDecoded[ch][i]);
        }
      }
    });

    it('allows a caller to observe samples in each chunk', async () => {
      const channels = makeSineFixture(FIXTURE_SAMPLES);
      const encoder = await createEncoder(STEREO_CHANNELS, SAMPLE_RATE);

      const observedSamples: number[] = [];
      const CHUNKS = 2;
      const chunkSize = FIXTURE_SAMPLES / CHUNKS;

      for (let i = 0; i < CHUNKS; i++) {
        const start = i * chunkSize;
        const chunk = channels.map((ch) => ch.subarray(start, start + chunkSize) as Float32Array);
        // Observe (e.g. compute peak) before / while encoding.
        const peak = Math.max(...Array.from(chunk[0], Math.abs));
        observedSamples.push(peak);
        encoder.push(chunk);
      }

      encoder.finish();

      // Both chunks should have been observable.
      expect(observedSamples).toHaveLength(CHUNKS);
      expect(observedSamples.every((p) => p > 0 && p <= 1)).toBe(true);
    });
  });

  describe('encoded size sanity (level 5)', () => {
    it('is within expected range for level ' + COMPRESSION_LEVEL + ' sine input', async () => {
      const channels = makeSineFixture(FIXTURE_SAMPLES);
      const flacBytes = await encodePcm(channels);

      const rawPcmBytes = FIXTURE_SAMPLES * STEREO_CHANNELS * (BITS_PER_SAMPLE / 8);
      const ratio = flacBytes.length / rawPcmBytes;

      // FLAC level 5 on a pure sine wave should compress to ~20–50% of raw size.
      // A ratio > 0.6 would suggest compression is not working (e.g. wrong level).
      expect(ratio).toBeGreaterThan(0.05);
      expect(ratio).toBeLessThan(0.6);
    });
  });
});
