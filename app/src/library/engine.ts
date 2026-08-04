/**
 * Song management: rename and delete. Both re-fetch the Song from IndexedDB
 * rather than trusting a caller-supplied copy, matching the read-fresh
 * convention the separation engine uses for its own catalogue mutations.
 */

import type { Song } from '../domain/types.ts';
import { getSong, putSong, deleteSong as deleteSongRow } from '../storage/db.ts';
import { deleteSongBytes } from '../storage/opfs.ts';
import { normalizeTitle } from './title.ts';

/**
 * Renames a Song. Returns the updated Song, or null if the Song is unknown
 * or the new title is blank or unchanged (a no-op, not a write).
 */
export async function renameSong(id: string, title: string): Promise<Song | null> {
  const song = await getSong(id);
  if (!song) return null;

  const next = normalizeTitle(title);
  if (next === null || next === song.title) return null;

  const updated: Song = { ...song, title: next };
  await putSong(updated);
  return updated;
}

/**
 * Deletes a Song: the catalogue row, then every OPFS file it referenced —
 * the Recording and all four stems (and their peaks). Leaves nothing
 * orphaned.
 */
export async function deleteSong(id: string): Promise<void> {
  const song = await getSong(id);
  if (!song) return;

  await deleteSongRow(id);
  await deleteSongBytes(song);
}
