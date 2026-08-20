/**
 * What a Song, and the whole library, actually costs on disk — the number
 * behind the "3 · 1.4 GB on disk" section meta. Derived from the StemRefs
 * and Recording already on each Song, not stored: a second copy of a number
 * this cheap to compute is a second thing to keep correct.
 */

import { ROLES, type Song } from '../domain/types.ts';

// The Recording is kept in full after separation (it is the reference mix
// and the source for any re-separation), so it is part of the cost.
export function songBytes(song: Song): number {
  let total = song.recording.bytes;
  for (const role of ROLES) total += song.stems[role].bytes;
  return total;
}

export function libraryBytes(songs: readonly Song[]): number {
  return songs.reduce((total, song) => total + songBytes(song), 0);
}
