import { describe, it, expect } from 'vitest';
import { songBytes, libraryBytes } from '../disk.ts';
import { defaultPracticeState, type Role, type Song } from '../../domain/types.ts';

function song(id: string, recordingBytes: number, stemBytes: number): Song {
  const stems = {} as Song['stems'];
  for (const role of ['vocals', 'drums', 'bass', 'other'] as Role[]) {
    stems[role] = { path: `${id}/${role}.flac`, bytes: stemBytes, peaksPath: `${id}/${role}.peaks` };
  }
  return {
    id,
    title: id,
    durationSec: 214,
    sampleRate: 44100,
    createdAt: 0,
    recording: { path: `${id}/rec`, bytes: recordingBytes, mimeType: 'audio/mpeg', origin: 'uploaded' },
    stems,
    practice: defaultPracticeState(),
  };
}

describe('songBytes', () => {
  // The Recording is kept in full after separation, so it counts — a Song's
  // true cost on disk is the Recording plus its four Stems.
  it('counts the Recording plus all four Stems', () => {
    expect(songBytes(song('a', 1000, 250))).toBe(2000);
  });
});

describe('libraryBytes', () => {
  it('sums every Song', () => {
    expect(libraryBytes([song('a', 1000, 250), song('b', 500, 125)])).toBe(3000);
  });

  it('is zero for an empty library', () => {
    expect(libraryBytes([])).toBe(0);
  });
});
