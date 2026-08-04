import { describe, it, expect } from 'vitest';
import { sortSongsNewestFirst } from '../sort.ts';
import type { Song } from '../../domain/types.ts';
import { defaultPracticeState } from '../../domain/types.ts';

function makeSong(overrides: Partial<Song> & { id: string; createdAt: number }): Song {
  return {
    title: overrides.id,
    durationSec: 180,
    sampleRate: 44100,
    recording: { path: `recordings/${overrides.id}`, bytes: 100, mimeType: 'audio/flac', origin: 'uploaded' },
    stems: {
      vocals: { path: '', bytes: 0, peaksPath: '' },
      drums: { path: '', bytes: 0, peaksPath: '' },
      bass: { path: '', bytes: 0, peaksPath: '' },
      other: { path: '', bytes: 0, peaksPath: '' },
    },
    practice: defaultPracticeState(),
    ...overrides,
  };
}

describe('sortSongsNewestFirst', () => {
  it('orders songs by createdAt descending', () => {
    const a = makeSong({ id: 'a', createdAt: 1000 });
    const b = makeSong({ id: 'b', createdAt: 3000 });
    const c = makeSong({ id: 'c', createdAt: 2000 });

    expect(sortSongsNewestFirst([a, b, c]).map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const a = makeSong({ id: 'a', createdAt: 1000 });
    const b = makeSong({ id: 'b', createdAt: 2000 });
    const input = [a, b];

    sortSongsNewestFirst(input);

    expect(input).toEqual([a, b]);
  });

  it('returns an empty array for an empty input', () => {
    expect(sortSongsNewestFirst([])).toEqual([]);
  });
});
