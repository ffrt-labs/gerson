/**
 * Vorbis comment tags carried by an exported FLAC stem — the interop
 * artifact that lets a song exported on one machine import elsewhere as the
 * same Song (§6.1), rather than a duplicate.
 */

import type { Role, Song } from '../domain/types.ts';
import type { VorbisTags } from '../codec/flac.ts';

// Bumped when the tag set below changes shape, so a future import path can
// tell an old export apart from a new one.
export const EXPORT_SCHEMA_VERSION = '1';

export function buildStemTags(song: Song, role: Role): VorbisTags {
  return {
    ROLE: role,
    SONG_ID: song.id,
    SCHEMA_VERSION: EXPORT_SCHEMA_VERSION,
    TITLE: song.title,
  };
}
