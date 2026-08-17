import { describe, it, expect, vi } from 'vitest';
import { createPlaybackContext, sampleRateMismatch, type CreateAudioContext } from '../context.ts';
import { SAMPLE_RATE } from '../../codec/flac.ts';

describe('createPlaybackContext', () => {
  // The invariant that broke in #89. Stems reach the stretcher as raw PCM
  // with no sample rate attached, so the context's rate is the only thing
  // deciding how fast they are consumed — an unpinned context played 44.1kHz
  // stems at the 48kHz device rate, 8.84% fast and ~1.5 semitones sharp.
  it('asks for a context pinned to the pipeline sample rate', () => {
    const create = vi.fn(() => ({ sampleRate: SAMPLE_RATE }) as AudioContext);
    createPlaybackContext(create as CreateAudioContext);
    expect(create).toHaveBeenCalledWith({ sampleRate: SAMPLE_RATE });
  });

  it('pins to 44100 specifically — the rate the stems are encoded at', () => {
    const create = vi.fn(() => ({ sampleRate: 44100 }) as AudioContext);
    createPlaybackContext(create as CreateAudioContext);
    expect(create).toHaveBeenCalledWith({ sampleRate: 44100 });
  });

  it('returns the created context', () => {
    const context = { sampleRate: SAMPLE_RATE } as AudioContext;
    expect(createPlaybackContext(() => context)).toBe(context);
  });

  // No fallback: a silent unpinned retry would reintroduce #89 as a fallback
  // path, which is worse than refusing to open the Song.
  it('propagates a rejected sample rate rather than falling back to an unpinned context', () => {
    const create = vi.fn(() => {
      throw new DOMException('rate not supported', 'NotSupportedError');
    });
    expect(() => createPlaybackContext(create as unknown as CreateAudioContext)).toThrow('rate not supported');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('sampleRateMismatch', () => {
  it('is false when the context matches the Song', () => {
    expect(sampleRateMismatch(44100, 44100)).toBe(false);
  });

  it('is true for the 48kHz device rate that caused #89', () => {
    expect(sampleRateMismatch(48000, 44100)).toBe(true);
  });

  it('is true when a Song row disagrees with the pipeline', () => {
    expect(sampleRateMismatch(44100, 48000)).toBe(true);
  });
});
