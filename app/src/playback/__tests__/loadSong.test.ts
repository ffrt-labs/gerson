import { describe, it, expect, vi } from 'vitest';
import { loadSongStem, peaksNeedRepair, songStemLoader, type LoadSongStemDeps } from '../loadSong.ts';
import { downmixToMono } from '../downmix.ts';
import { computePeaks } from '../../separation/peaks.ts';
import { stemPath, peaksPath } from '../../storage/opfs.ts';
import { defaultPracticeState } from '../../domain/types.ts';
import type { Song } from '../../domain/types.ts';

const SONG_ID = 'song-abc';

function makeSong(): Song {
  return {
    id: SONG_ID,
    title: 'Test Song',
    durationSec: 1,
    sampleRate: 44100,
    createdAt: 0,
    recording: { path: `recordings/${SONG_ID}`, bytes: 0, mimeType: 'audio/flac', origin: 'uploaded' },
    stems: {
      vocals: { path: stemPath(SONG_ID, 'vocals'), bytes: 0, peaksPath: peaksPath(SONG_ID, 'vocals') },
      drums: { path: stemPath(SONG_ID, 'drums'), bytes: 0, peaksPath: peaksPath(SONG_ID, 'drums') },
      bass: { path: stemPath(SONG_ID, 'bass'), bytes: 0, peaksPath: peaksPath(SONG_ID, 'bass') },
      other: { path: stemPath(SONG_ID, 'other'), bytes: 0, peaksPath: peaksPath(SONG_ID, 'other') },
    },
    practice: defaultPracticeState(),
  };
}

function notFound(): DOMException {
  return new DOMException('not found', 'NotFoundError');
}

function fakeChannels(length = 512): [Float32Array, Float32Array] {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = Math.sin(i);
    right[i] = Math.cos(i);
  }
  return [left, right];
}

function makeDeps(overrides: Partial<LoadSongStemDeps> = {}): LoadSongStemDeps {
  const [left, right] = fakeChannels();
  return {
    readStem: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readPeaks: vi.fn(async () => { throw notFound(); }),
    writePeaks: vi.fn(async () => undefined),
    decodeFlac: vi.fn(async () => ({
      channels: [left, right],
      sampleRate: 44100,
      bitsPerSample: 16,
      tags: {},
    })),
    ...overrides,
  };
}

describe('peaksNeedRepair', () => {
  it('is true when peaks are missing', () => {
    expect(peaksNeedRepair(null, 1000)).toBe(true);
  });

  it('is true when the peaks length does not match the expected size for the stem', () => {
    const wrongLength = new Int8Array(4); // one pixel's worth; too short for 1000 samples
    expect(peaksNeedRepair(wrongLength, 1000)).toBe(true);
  });

  it('is false when the peaks length matches the expected size for the stem', () => {
    const numPixels = Math.ceil(1000 / 256);
    const correctLength = new Int8Array(numPixels * 4);
    expect(peaksNeedRepair(correctLength, 1000)).toBe(false);
  });
});

describe('loadSongStem', () => {
  it('reads the stem FLAC and decodes it to transferable channels, never an AudioBuffer', async () => {
    const song = makeSong();
    const deps = makeDeps();

    const result = await loadSongStem(song, 'bass', false, deps);

    expect(deps.readStem).toHaveBeenCalledWith(song.stems.bass.path);
    expect(deps.decodeFlac).toHaveBeenCalledTimes(1);
    expect(result.channels).toHaveLength(2);
    for (const ch of result.channels) expect(ch).toBeInstanceOf(Float32Array);
  });

  it('downmixes to a single channel when mono is requested', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const deps = makeDeps({
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });

    const result = await loadSongStem(song, 'bass', true, deps);

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toEqual(downmixToMono(left, right));
  });

  it('computes peaks from the full stereo signal even when mono is requested', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const deps = makeDeps({
      readPeaks: vi.fn(async () => { throw notFound(); }),
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });

    await loadSongStem(song, 'bass', true, deps);

    const [, , peaks] = (deps.writePeaks as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(peaks).toEqual(computePeaks(left, right));
  });

  it('recomputes and writes peaks when the peaks file is missing', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const deps = makeDeps({
      readPeaks: vi.fn(async () => { throw notFound(); }),
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });

    await loadSongStem(song, 'drums', false, deps);

    expect(deps.writePeaks).toHaveBeenCalledTimes(1);
    const [id, role, peaks] = (deps.writePeaks as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe(song.id);
    expect(role).toBe('drums');
    expect(peaks).toEqual(computePeaks(left, right));
  });

  it('recomputes and writes peaks when the existing peaks length does not match the stem', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const staleWrongLength = new Int8Array(4); // stale from before the stem was re-encoded at a different length
    const deps = makeDeps({
      readPeaks: vi.fn(async () => staleWrongLength),
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });

    await loadSongStem(song, 'other', false, deps);

    expect(deps.writePeaks).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite peaks that already match the stem', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const correctPeaks = computePeaks(left, right);
    const deps = makeDeps({
      readPeaks: vi.fn(async () => correctPeaks),
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });

    await loadSongStem(song, 'vocals', false, deps);

    expect(deps.writePeaks).not.toHaveBeenCalled();
  });

  it('does not fail the Song when peaks repair is needed — the load still resolves', async () => {
    const song = makeSong();
    const deps = makeDeps({ readPeaks: vi.fn(async () => { throw notFound(); }) });

    await expect(loadSongStem(song, 'vocals', false, deps)).resolves.toBeDefined();
  });

  it('propagates a non-NotFoundError from reading peaks rather than treating it as missing', async () => {
    const song = makeSong();
    const deps = makeDeps({ readPeaks: vi.fn(async () => { throw new Error('disk error'); }) });

    await expect(loadSongStem(song, 'vocals', false, deps)).rejects.toThrow('disk error');
  });
});

describe('songStemLoader', () => {
  it('binds loadSongStem to the given Song so it can be handed to createTransport as a StemLoader', async () => {
    const song = makeSong();
    const deps = makeDeps();
    const loader = songStemLoader(song, false, deps);

    await loader('bass');

    expect(deps.readStem).toHaveBeenCalledWith(song.stems.bass.path);
  });

  it('binds the mono flag through to loadSongStem', async () => {
    const song = makeSong();
    const [left, right] = fakeChannels();
    const deps = makeDeps({
      decodeFlac: vi.fn(async () => ({ channels: [left, right], sampleRate: 44100, bitsPerSample: 16, tags: {} })),
    });
    const loader = songStemLoader(song, true, deps);

    const result = await loader('bass');

    expect(result.channels).toHaveLength(1);
  });
});
