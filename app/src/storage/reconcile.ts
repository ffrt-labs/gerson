/**
 * Startup reconciliation (spec §7.2, §3.4): a Song in the library is
 * supposed to play (invariant 1, CONTEXT.md). When the browser evicts OPFS
 * bytes out from under a catalogue row — origin-wide, all or nothing — the
 * row stops being honest and has to go, reported once at the origin level
 * rather than as N broken Songs.
 *
 * Peaks are deliberately not checked here: a peaks-only loss is repaired
 * lazily by loadSongStem the next time the Song is opened (§3.4), so
 * checking for it here would only cost every startup a FLAC decode per
 * stem for a repair the player already owns.
 */

import type { Song } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import { getAllSongs, deleteSong as deleteSongRow } from './db.ts';
import { fileExists, deleteSongBytes } from './opfs.ts';

export interface ReconcileDeps {
  getAllSongs: typeof getAllSongs;
  deleteSongRow: typeof deleteSongRow;
  deleteSongBytes: typeof deleteSongBytes;
  fileExists: typeof fileExists;
}

const defaultDeps: ReconcileDeps = { getAllSongs, deleteSongRow, deleteSongBytes, fileExists };

export interface ReconcileResult {
  songs: Song[];
  removedCount: number;
}

async function songIsPlayable(song: Song, deps: ReconcileDeps): Promise<boolean> {
  const paths = [song.recording.path, ...ROLES.map(role => song.stems[role].path)];
  const results = await Promise.all(paths.map(path => deps.fileExists(path)));
  return results.every(Boolean);
}

/**
 * Deletes catalogue rows whose files are gone — no tombstone, no
 * re-separable stub, matching invariant 1. Returns the survivors, so a
 * caller can render the library straight from this result without a
 * second read.
 *
 * Every Song is checked concurrently — a library's worth of sequential
 * round-trips would make this run's cost scale with library size, which is
 * exactly what a startup check should not do.
 */
export async function reconcileLibrary(deps: ReconcileDeps = defaultDeps): Promise<ReconcileResult> {
  const songs = await deps.getAllSongs();
  const playable = await Promise.all(songs.map(song => songIsPlayable(song, deps)));

  const survivors: Song[] = [];
  const broken: Song[] = [];
  songs.forEach((song, i) => (playable[i] ? survivors.push(song) : broken.push(song)));

  await Promise.all(
    broken.map(song => Promise.all([deps.deleteSongRow(song.id), deps.deleteSongBytes(song)])),
  );

  return { songs: survivors, removedCount: broken.length };
}
