import { describe, it, expect, vi } from 'vitest';
import { reconcileLibrary, type ReconcileDeps } from '../reconcile.ts';
import { stemPath, peaksPath } from '../opfs.ts';
import { defaultPracticeState } from '../../domain/types.ts';
import type { Song } from '../../domain/types.ts';

function makeSong(id: string): Song {
  return {
    id,
    title: `Song ${id}`,
    durationSec: 120,
    sampleRate: 44100,
    createdAt: 0,
    recording: { path: `recordings/${id}`, bytes: 100, mimeType: 'audio/flac', origin: 'uploaded' },
    stems: {
      vocals: { path: stemPath(id, 'vocals'), bytes: 100, peaksPath: peaksPath(id, 'vocals') },
      drums: { path: stemPath(id, 'drums'), bytes: 100, peaksPath: peaksPath(id, 'drums') },
      bass: { path: stemPath(id, 'bass'), bytes: 100, peaksPath: peaksPath(id, 'bass') },
      other: { path: stemPath(id, 'other'), bytes: 100, peaksPath: peaksPath(id, 'other') },
    },
    practice: defaultPracticeState(),
  };
}

function makeDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    getAllSongs: vi.fn(async () => []),
    deleteSongRow: vi.fn(async () => undefined),
    deleteSongBytes: vi.fn(async () => undefined),
    fileExists: vi.fn(async () => true),
    ...overrides,
  };
}

describe('reconcileLibrary', () => {
  it('keeps a Song whose Recording and all four Stems exist', async () => {
    const song = makeSong('a');
    const deps = makeDeps({ getAllSongs: vi.fn(async () => [song]) });

    const result = await reconcileLibrary(deps);

    expect(result.songs).toEqual([song]);
    expect(result.removedCount).toBe(0);
    expect(deps.deleteSongRow).not.toHaveBeenCalled();
    expect(deps.deleteSongBytes).not.toHaveBeenCalled();
  });

  it('removes a Song whose Recording is missing, deleting its row and bytes outright', async () => {
    const song = makeSong('b');
    const fileExists = vi.fn(async (path: string) => path !== song.recording.path);
    const deps = makeDeps({ getAllSongs: vi.fn(async () => [song]), fileExists });

    const result = await reconcileLibrary(deps);

    expect(result.songs).toEqual([]);
    expect(result.removedCount).toBe(1);
    expect(deps.deleteSongRow).toHaveBeenCalledWith(song.id);
    expect(deps.deleteSongBytes).toHaveBeenCalledWith(song);
  });

  it('removes a Song missing just one of its four Stems', async () => {
    const song = makeSong('c');
    const fileExists = vi.fn(async (path: string) => path !== song.stems.bass.path);
    const deps = makeDeps({ getAllSongs: vi.fn(async () => [song]), fileExists });

    const result = await reconcileLibrary(deps);

    expect(result.songs).toEqual([]);
    expect(result.removedCount).toBe(1);
  });

  it('never checks peaks files, so a peaks-only loss never removes the Song', async () => {
    const song = makeSong('d');
    // Every path fileExists is asked about must be a Recording or Stem
    // path — never a peaksPath — and all of those report present.
    const fileExists = vi.fn(async (path: string) => {
      expect(path).not.toMatch(/\.peaks$/);
      return true;
    });
    const deps = makeDeps({ getAllSongs: vi.fn(async () => [song]), fileExists });

    const result = await reconcileLibrary(deps);

    expect(result.songs).toEqual([song]);
    expect(result.removedCount).toBe(0);
  });

  it('reports removedCount as one origin-level count, not one call per Song', async () => {
    const broken1 = makeSong('e1');
    const broken2 = makeSong('e2');
    const ok = makeSong('e3');
    const fileExists = vi.fn(async (path: string) => !path.includes('e1') && !path.includes('e2'));
    const deps = makeDeps({ getAllSongs: vi.fn(async () => [broken1, broken2, ok]), fileExists });

    const result = await reconcileLibrary(deps);

    expect(result.removedCount).toBe(2);
    expect(result.songs).toEqual([ok]);
  });

  it('reports zero removed and all Songs kept when nothing is missing', async () => {
    const songs = [makeSong('f1'), makeSong('f2')];
    const deps = makeDeps({ getAllSongs: vi.fn(async () => songs) });

    const result = await reconcileLibrary(deps);

    expect(result.removedCount).toBe(0);
    expect(result.songs).toEqual(songs);
  });
});
