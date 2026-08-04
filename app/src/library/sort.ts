import type { Song } from '../domain/types.ts';

export function sortSongsNewestFirst(songs: Song[]): Song[] {
  return [...songs].sort((a, b) => b.createdAt - a.createdAt);
}
