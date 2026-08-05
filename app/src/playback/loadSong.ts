/**
 * Loads one Stem of a Song for playback: reads its FLAC bytes off OPFS and
 * decodes them straight to transferable Float32Array channels — never an
 * AudioBuffer (§4.4) — via the same codec used to write them.
 *
 * Also owns the peaks repair path (§3.4): a Song in the library is supposed
 * to imply its peaks exist, but a partial eviction can leave a peaks file
 * missing or stale relative to the stem it describes. Repairing here, on
 * open, means that costs seconds — a recompute from the decoded PCM already
 * in hand — rather than the Song.
 */

import type { Role, Song } from '../domain/types.ts';
import type { StemBuffers, StemLoader } from './transport.ts';
import { decodeFlac } from '../codec/flac.ts';
import { computePeaks, PEAKS_SAMPLES_PER_PIXEL } from '../separation/peaks.ts';
import { readStem, readPeaks, writePeaks } from '../storage/opfs.ts';

export interface LoadSongStemDeps {
  readStem: typeof readStem;
  readPeaks: typeof readPeaks;
  writePeaks: typeof writePeaks;
  decodeFlac: typeof decodeFlac;
}

const defaultDeps: LoadSongStemDeps = { readStem, readPeaks, writePeaks, decodeFlac };

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

function expectedPeaksLength(sampleCount: number): number {
  return Math.ceil(sampleCount / PEAKS_SAMPLES_PER_PIXEL) * 4;
}

/** True when `existing` can't have come from the stem it's supposed to describe. */
export function peaksNeedRepair(existing: Int8Array | null, sampleCount: number): boolean {
  return existing === null || existing.length !== expectedPeaksLength(sampleCount);
}

export async function loadSongStem(
  song: Song,
  role: Role,
  deps: LoadSongStemDeps = defaultDeps,
): Promise<StemBuffers> {
  const ref = song.stems[role];
  const flacBytes = await deps.readStem(ref.path);
  const { channels } = await deps.decodeFlac(flacBytes);

  let existingPeaks: Int8Array | null;
  try {
    existingPeaks = await deps.readPeaks(ref.peaksPath);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    existingPeaks = null;
  }

  if (peaksNeedRepair(existingPeaks, channels[0].length)) {
    const [left, right] = channels;
    await deps.writePeaks(song.id, role, computePeaks(left, right));
  }

  return { channels };
}

/** Binds loadSongStem to one Song, ready to hand to createTransport. */
export function songStemLoader(song: Song, deps: LoadSongStemDeps = defaultDeps): StemLoader {
  return (role) => loadSongStem(song, role, deps);
}
