/**
 * Import orchestration (§6.2): turns a candidate set of dropped/unzipped
 * files into a Song, or into a request for the explicit role-mapping modal
 * when the set can't be trusted to identify itself.
 *
 * Two rules generate almost every decision here: never guess invisibly, and
 * never make the user pay for the same nine minutes twice. The second rule
 * is why identity is checked as early as possible — before any decode for a
 * tagged set, and before any OPFS write for an untagged one.
 */

import type { Role, Song, StemRef } from '../domain/types.ts';
import { ROLES, defaultPracticeState } from '../domain/types.ts';
import { getSong, getSeparation, putSong } from '../storage/db.ts';
import { writeRecording, writeStem, writePeaks, recordingPath, stemPath, peaksPath } from '../storage/opfs.ts';
import { encodePcm, readVorbisComments, SAMPLE_RATE } from '../codec/flac.ts';
import { hashBytes } from '../intake/hash.ts';
import { computePeaks } from '../separation/peaks.ts';
import { checkSpace } from '../intake/space.ts';
import { normalizeTitle } from '../library/title.ts';
import { decodeCandidate, type DecodedCandidate } from './decodeCandidate.ts';
import { prefillRoles } from './roleMatch.ts';

async function persistDefault(): Promise<boolean> {
  return navigator.storage.persist();
}

export interface RawFile {
  name: string;
  bytes: Uint8Array;
}

export interface MappingCandidate {
  name: string;
  durationSec: number;
  prefillRole: Role | null;
}

export type PrepareResult =
  | { kind: 'redirect'; file: RawFile }
  | { kind: 'refuse-partial'; count: number }
  | { kind: 'duplicate-names'; names: string[] }
  | { kind: 'decode-failed'; name: string; message: string }
  | { kind: 'refuse-length'; durations: Array<{ name: string; durationSec: number }> }
  | { kind: 'exists'; id: string; title: string }
  | { kind: 'inflight'; id: string; title: string }
  | { kind: 'nospace'; needsBytes: number }
  | { kind: 'needs-mapping'; title: string; candidates: MappingCandidate[]; decoded: Record<string, DecodedCandidate> }
  | { kind: 'imported'; song: Song };

export type CommitResult =
  | { kind: 'imported'; song: Song }
  | { kind: 'exists'; song: Song }
  | { kind: 'inflight'; id: string; title: string }
  | { kind: 'nospace'; needsBytes: number };

export interface ImportDeps {
  getSong: typeof getSong;
  getSeparation: typeof getSeparation;
  putSong: typeof putSong;
  writeRecording: typeof writeRecording;
  writeStem: typeof writeStem;
  writePeaks: typeof writePeaks;
  decodeCandidate: typeof decodeCandidate;
  encodePcm: typeof encodePcm;
  hashBytes: typeof hashBytes;
  computePeaks: typeof computePeaks;
  checkSpace: typeof checkSpace;
  persist: () => Promise<boolean>;
}

const defaultDeps: ImportDeps = {
  getSong, getSeparation, putSong,
  writeRecording, writeStem, writePeaks,
  decodeCandidate, encodePcm, hashBytes, computePeaks,
  checkSpace, persist: persistDefault,
};

// Third-party sets pick up encoder padding and codec delay; refusing a set
// because one stem is 23ms short would be pedantic and inexplicable. Our
// own exports are sample-identical, so this only ever bites third-party sets.
const LENGTH_SPREAD_TOLERANCE_SEC = 1;

function lengthSpreadOk(durations: number[]): boolean {
  return Math.max(...durations) - Math.min(...durations) <= LENGTH_SPREAD_TOLERANCE_SEC;
}

// Strips a role suffix in our own naming convention ("<title> - vocals.flac")
// so an untagged set of our own WAV exports still gets a sensible title
// instead of the literal filename. Anything else falls back to a generic
// default — there is no field in the mapping modal to ask the user for one.
const ROLE_SUFFIX = /\s*[-_]?\s*(vocals?|vox|drums?|bass|other|instrumental|inst)$/i;

export function deriveImportTitle(names: string[]): string {
  const first = names[0]?.replace(/\.[^.]+$/, '').replace(ROLE_SUFFIX, '') ?? '';
  return normalizeTitle(first) ?? 'Imported song';
}

interface TaggedInfo {
  id: string;
  title: string;
  roleByIndex: Role[]; // same order as the input files
}

// A set counts as tagged only when all four files carry a valid, distinct
// ROLE and agree on SONG_ID — a partial or inconsistent tag set is not
// trustworthy, and the safe fallback is the same explicit mapping an
// untagged set goes through, not a guess.
function classifyTagged(files: RawFile[]): TaggedInfo | null {
  const tagsPerFile = files.map(f => readVorbisComments(f.bytes));

  const roleByIndex = tagsPerFile.map(t => t['ROLE']?.toLowerCase());
  if (!roleByIndex.every((r): r is Role => !!r && (ROLES as readonly string[]).includes(r))) return null;
  if (new Set(roleByIndex).size !== ROLES.length) return null;

  const ids = tagsPerFile.map(t => t['SONG_ID']);
  if (!ids.every(id => !!id) || new Set(ids).size !== 1) return null;

  const title = tagsPerFile.find(t => t['TITLE'])?.['TITLE'] ?? 'Imported song';

  return { id: ids[0]!, title, roleByIndex: roleByIndex as Role[] };
}

type Identity =
  | { kind: 'exists'; song: Song }
  | { kind: 'inflight'; id: string; title: string }
  | null;

async function checkIdentity(id: string, deps: ImportDeps): Promise<Identity> {
  const song = await deps.getSong(id);
  if (song) return { kind: 'exists', song };
  // A failed Separation is not "in flight" — it persists until dismissed
  // (§7.4), and its id is exactly what import is the recovery path for.
  // Matches enqueue.ts's own status !== 'failed' check.
  const sep = await deps.getSeparation(id);
  if (sep && sep.status !== 'failed') return { kind: 'inflight', id, title: sep.title };
  return null;
}

/**
 * Validates and (for a tagged set) commits a candidate import in one pass.
 * An untagged set stops at 'needs-mapping' — nothing is written until the
 * caller collects a role assignment and calls commitImport.
 */
export async function prepareImport(files: RawFile[], deps: ImportDeps = defaultDeps): Promise<PrepareResult> {
  if (files.length === 1) return { kind: 'redirect', file: files[0] };
  if (files.length !== 4) return { kind: 'refuse-partial', count: files.length };

  // A zip nesting the same filename under two different folders (e.g. two
  // songs' worth of stems zipped together by mistake) would otherwise
  // silently collapse to one PCM buffer shared by two roles — the exact
  // kind of invisible guess §6.2 rules out, just arrived at a different way.
  const duplicateNames = [...new Set(files.map(f => f.name).filter((name, i, all) => all.indexOf(name) !== i))];
  if (duplicateNames.length > 0) return { kind: 'duplicate-names', names: duplicateNames };

  const tagged = classifyTagged(files);

  // Identity is checked before any work: for a tagged set the id is right
  // there in the tags, so a duplicate is caught before a single byte is decoded.
  if (tagged) {
    const identity = await checkIdentity(tagged.id, deps);
    if (identity?.kind === 'exists') return { kind: 'exists', id: identity.song.id, title: identity.song.title };
    if (identity?.kind === 'inflight') return { kind: 'inflight', id: identity.id, title: identity.title };
  }

  const decoded: DecodedCandidate[] = [];
  for (const file of files) {
    try {
      decoded.push(await deps.decodeCandidate(file.bytes));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { kind: 'decode-failed', name: file.name, message };
    }
  }

  if (!lengthSpreadOk(decoded.map(d => d.durationSec))) {
    return {
      kind: 'refuse-length',
      durations: files.map((f, i) => ({ name: f.name, durationSec: decoded[i].durationSec })),
    };
  }

  if (tagged) {
    const byRole = {} as Record<Role, DecodedCandidate>;
    tagged.roleByIndex.forEach((role, i) => { byRole[role] = decoded[i]; });

    const result = await commitImport(byRole, tagged.title, tagged.id, deps);
    if (result.kind === 'exists') return { kind: 'exists', id: result.song.id, title: result.song.title };
    if (result.kind === 'inflight' || result.kind === 'nospace') return result;
    return { kind: 'imported', song: result.song };
  }

  const prefill = prefillRoles(files.map(f => f.name));
  const byName = Object.fromEntries(files.map((f, i) => [f.name, decoded[i]]));

  return {
    kind: 'needs-mapping',
    title: deriveImportTitle(files.map(f => f.name)),
    candidates: files.map((f, i) => ({ name: f.name, durationSec: decoded[i].durationSec, prefillRole: prefill[i] })),
    decoded: byName,
  };
}

function padStereo(candidate: DecodedCandidate, length: number): DecodedCandidate {
  if (candidate.left.length === length) return candidate;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left.set(candidate.left);
  right.set(candidate.right);
  return { left, right, durationSec: length / SAMPLE_RATE };
}

function sumStereo(padded: Record<Role, DecodedCandidate>): [Float32Array, Float32Array] {
  const length = padded[ROLES[0]].left.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const role of ROLES) {
    const { left: l, right: r } = padded[role];
    for (let i = 0; i < length; i++) {
      left[i] += l[i];
      right[i] += r[i];
    }
  }
  return [left, right];
}

/**
 * Pads the four stems to the longest one's length, synthesises the
 * Recording by summing them (origin: 'summed'), derives identity (the given
 * tag id, or a hash of the synthesised Recording), and — only once that id
 * is confirmed not to already exist in the library — writes stems, peaks,
 * and the Recording to OPFS before the catalogue row. Called either
 * directly by prepareImport (tagged sets) or by the mapping modal's confirm
 * handler (untagged sets, after the user assigns Roles).
 */
export async function commitImport(
  byRole: Record<Role, DecodedCandidate>,
  title: string,
  presetId: string | null,
  deps: ImportDeps = defaultDeps,
): Promise<CommitResult> {
  const longest = Math.max(...ROLES.map(role => byRole[role].left.length));
  const padded = Object.fromEntries(
    ROLES.map(role => [role, padStereo(byRole[role], longest)]),
  ) as Record<Role, DecodedCandidate>;

  const [sumLeft, sumRight] = sumStereo(padded);
  const recordingBytes = await deps.encodePcm([sumLeft, sumRight], SAMPLE_RATE);
  const id = presetId ?? await deps.hashBytes(recordingBytes);

  const identity = await checkIdentity(id, deps);
  if (identity?.kind === 'exists') return { kind: 'exists', song: identity.song };
  if (identity?.kind === 'inflight') return identity;

  // Refuse up front if the result won't fit — the write otherwise lands
  // after all the decode/sum work above, maximum work for total loss (§7.2).
  const spaceResult = await deps.checkSpace(recordingBytes.byteLength);
  if (!spaceResult.ok) return { kind: 'nospace', needsBytes: spaceResult.needsBytes };

  // OPFS before IDB: a crash between the two leaves orphaned bytes but no
  // dangling catalogue row.
  await deps.writeRecording(id, recordingBytes);
  await deps.persist(); // first save — matches enqueue.ts's own request

  const stemRefs = {} as Record<Role, StemRef>;
  for (const role of ROLES) {
    const { left, right } = padded[role];
    const peaks = deps.computePeaks(left, right);
    const flacBytes = await deps.encodePcm([left, right], SAMPLE_RATE, { ROLE: role.toUpperCase(), ID: id });
    await deps.writeStem(id, role, flacBytes);
    await deps.writePeaks(id, role, peaks);
    stemRefs[role] = { path: stemPath(id, role), bytes: flacBytes.byteLength, peaksPath: peaksPath(id, role) };
  }

  const song: Song = {
    id,
    title: normalizeTitle(title) ?? 'Imported song',
    durationSec: longest / SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
    createdAt: Date.now(),
    recording: { path: recordingPath(id), bytes: recordingBytes.byteLength, mimeType: 'audio/flac', origin: 'summed' },
    stems: stemRefs,
    practice: defaultPracticeState(),
  };

  await deps.putSong(song);
  return { kind: 'imported', song };
}
