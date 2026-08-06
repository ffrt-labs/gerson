import { describe, it, expect } from 'vitest';
import { buildStemTags, EXPORT_SCHEMA_VERSION } from '../tags.ts';
import { defaultPracticeState, type Song } from '../../domain/types.ts';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'abc123',
    title: 'My Song',
    durationSec: 180,
    sampleRate: 44100,
    createdAt: 0,
    recording: { path: 'recordings/abc123', bytes: 100, mimeType: 'audio/mpeg', origin: 'uploaded' },
    stems: {
      vocals: { path: 'stems/abc123/vocals.flac', bytes: 1, peaksPath: 'stems/abc123/vocals.peaks' },
      drums:  { path: 'stems/abc123/drums.flac',  bytes: 1, peaksPath: 'stems/abc123/drums.peaks' },
      bass:   { path: 'stems/abc123/bass.flac',   bytes: 1, peaksPath: 'stems/abc123/bass.peaks' },
      other:  { path: 'stems/abc123/other.flac',  bytes: 1, peaksPath: 'stems/abc123/other.peaks' },
    },
    practice: defaultPracticeState(),
    ...overrides,
  };
}

describe('buildStemTags', () => {
  it('carries role, song id, schema version and title', () => {
    const song = makeSong();
    const tags = buildStemTags(song, 'vocals');

    expect(tags['ROLE']).toBe('vocals');
    expect(tags['SONG_ID']).toBe('abc123');
    expect(tags['SCHEMA_VERSION']).toBe(EXPORT_SCHEMA_VERSION);
    expect(tags['TITLE']).toBe('My Song');
  });

  it('reflects the Role passed in, not any fixed default', () => {
    const song = makeSong();
    expect(buildStemTags(song, 'drums')['ROLE']).toBe('drums');
    expect(buildStemTags(song, 'bass')['ROLE']).toBe('bass');
    expect(buildStemTags(song, 'other')['ROLE']).toBe('other');
  });

  it('uses the current Song id and title, not stale ones', () => {
    const song = makeSong({ id: 'zzz', title: 'Renamed' });
    const tags = buildStemTags(song, 'other');
    expect(tags['SONG_ID']).toBe('zzz');
    expect(tags['TITLE']).toBe('Renamed');
  });
});
