/**
 * Reads one Stem's peaks for display. Never repairs or recomputes here:
 * `createTransport` already ran `loadSongStem` for every Role before it
 * resolved, and that repair path (§3.4) guarantees a Song's peaks are valid
 * on disk by the time anything downstream of a ready Transport asks for
 * them — so this is a plain OPFS read, never a PCM decode.
 */

import type { Role, Song } from '../domain/types.ts';
import { readPeaks } from '../storage/opfs.ts';

export interface LoadPeaksDeps {
  readPeaks: typeof readPeaks;
}

const defaultDeps: LoadPeaksDeps = { readPeaks };

export async function loadSongPeaks(song: Song, role: Role, deps: LoadPeaksDeps = defaultDeps): Promise<Int8Array> {
  return deps.readPeaks(song.stems[role].peaksPath);
}
