/**
 * Song management: rename, delete, and practice-state saves. All three
 * re-fetch the Song from IndexedDB rather than trusting a caller-supplied
 * copy, matching the read-fresh convention the separation engine uses for
 * its own catalogue mutations.
 */

import type { PracticeState, Song } from '../domain/types.ts';
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

// A dragged gain/tempo slider fires savePractice far faster than one
// read-modify-write round-trip completes. Chained onto this queue, each
// call's read only starts once the previous call's write has landed — so
// two overlapping calls can never resolve their reads out of call order and
// have the older one's write land last, clobbering a newer value.
let practiceQueue: Promise<unknown> = Promise.resolve();

/**
 * Overwrites the Song's single Practice state — never creates a variant.
 * Returns the updated Song, or null if the Song is unknown.
 */
export function savePractice(id: string, practice: PracticeState): Promise<Song | null> {
  const result = practiceQueue.then(async () => {
    const song = await getSong(id);
    if (!song) return null;

    const updated: Song = { ...song, practice };
    await putSong(updated);
    return updated;
  });
  // Keep the chain alive even if this call failed — a rejection must not
  // wedge every subsequent save.
  practiceQueue = result.catch(() => {});
  return result;
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
