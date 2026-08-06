import { describe, it, expect, vi } from 'vitest';
import { loadSongPeaks } from '../loadPeaks.ts';
import { defaultPracticeState, type Song } from '../../domain/types.ts';

function fakeSong(): Song {
  return {
    id: 'abc123',
    title: 'Test Song',
    durationSec: 180,
    sampleRate: 44100,
    createdAt: 0,
    recording: { path: 'recordings/abc123', bytes: 1000, mimeType: 'audio/flac', origin: 'uploaded' },
    stems: {
      vocals: { path: 'stems/abc123/vocals.flac', bytes: 100, peaksPath: 'stems/abc123/vocals.peaks' },
      drums: { path: 'stems/abc123/drums.flac', bytes: 100, peaksPath: 'stems/abc123/drums.peaks' },
      bass: { path: 'stems/abc123/bass.flac', bytes: 100, peaksPath: 'stems/abc123/bass.peaks' },
      other: { path: 'stems/abc123/other.flac', bytes: 100, peaksPath: 'stems/abc123/other.peaks' },
    },
    practice: defaultPracticeState(),
  };
}

describe('loadSongPeaks', () => {
  it('reads the given role\'s peaks path off the Song, nothing else', async () => {
    const readPeaks = vi.fn(async () => new Int8Array([1, -1, 2, -2]));
    const song = fakeSong();

    const result = await loadSongPeaks(song, 'bass', { readPeaks });

    expect(readPeaks).toHaveBeenCalledExactlyOnceWith('stems/abc123/bass.peaks');
    expect(result).toEqual(new Int8Array([1, -1, 2, -2]));
  });

  it('never decodes or repairs — it is a plain passthrough to the storage read', async () => {
    const readPeaks = vi.fn(async () => new Int8Array(0));
    const song = fakeSong();

    await loadSongPeaks(song, 'vocals', { readPeaks });

    expect(readPeaks).toHaveBeenCalledTimes(1);
  });
});
