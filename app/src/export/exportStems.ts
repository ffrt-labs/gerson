/**
 * "Export stems" (§6.1): four files, one per Role, neutral regardless of
 * gain, mute, solo, loop or the current tempo — the interop and re-import
 * artifact, so it reads the stored 1× stems straight off OPFS rather than
 * going anywhere near a Transport.
 *
 * FLAC is the default: the stored bytes are already the export, so tagging
 * is a splice (tagFlac), not a decode/re-encode. WAV is the visible
 * alternative, decoded then written fresh since WAV carries no tag block —
 * the round-trip caveat belongs to the caller offering the choice, not here.
 */

import type { Role, Song } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import { readStem } from '../storage/opfs.ts';
import { decodeFlac, tagFlac } from '../codec/flac.ts';
import { encodeWav } from '../codec/wav.ts';
import { buildStemTags } from './tags.ts';
import { stemFilename } from './filename.ts';

export type ExportFormat = 'flac' | 'wav';

export interface ExportedFile {
  role: Role;
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportStemsDeps {
  readStem: typeof readStem;
  decodeFlac: typeof decodeFlac;
}

const defaultDeps: ExportStemsDeps = { readStem, decodeFlac };

async function exportOneFlac(song: Song, role: Role, deps: ExportStemsDeps): Promise<ExportedFile> {
  const stored = await deps.readStem(song.stems[role].path);
  const tagged = tagFlac(stored, buildStemTags(song, role));
  return { role, name: stemFilename(song.title, role, 'flac'), bytes: tagged, mimeType: 'audio/flac' };
}

async function exportOneWav(song: Song, role: Role, deps: ExportStemsDeps): Promise<ExportedFile> {
  const stored = await deps.readStem(song.stems[role].path);
  const { channels, sampleRate } = await deps.decodeFlac(stored);
  const wav = encodeWav(channels, sampleRate);
  return { role, name: stemFilename(song.title, role, 'wav'), bytes: wav, mimeType: 'audio/wav' };
}

/**
 * Produces the four exported stem files for a Song, one per Role, in a
 * fixed order (§domain: vocals, drums, bass, other).
 */
export async function exportStems(
  song: Song,
  format: ExportFormat,
  deps: ExportStemsDeps = defaultDeps,
): Promise<ExportedFile[]> {
  const exportOne = format === 'flac' ? exportOneFlac : exportOneWav;
  return Promise.all(ROLES.map(role => exportOne(song, role, deps)));
}
