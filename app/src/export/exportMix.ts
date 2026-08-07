/**
 * "Export mix" (§6.1): one file — a rendering of what you are hearing, so
 * unlike Export stems it is *not* neutral. Gain, mute and solo are honoured
 * (mirroring transport.ts's own appliedGain), and when a loop is set the
 * render covers only that region. Tempo stays 1× unless the caller passes
 * applyTempo, in which case the render goes through the same stretcher
 * engine as playback, in an OfflineAudioContext (§4.7) — see
 * playback/offlineMix.ts.
 */

import type { LoopRegion, PracticeState, Role, Song } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import { readStem } from '../storage/opfs.ts';
import { decodeFlac, encodePcm, SAMPLE_RATE } from '../codec/flac.ts';
import { encodeWav } from '../codec/wav.ts';
import { mixFilename } from './filename.ts';
import type { ExportFormat } from './exportStems.ts';
import { renderMixOffline, type OfflineMixStem } from '../playback/offlineMix.ts';

export interface ExportedMixFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface ExportMixDeps {
  readStem: typeof readStem;
  decodeFlac: typeof decodeFlac;
  renderMixOffline: typeof renderMixOffline;
}

const defaultDeps: ExportMixDeps = { readStem, decodeFlac, renderMixOffline };

// Mirrors transport.ts's appliedGain (§4.1): mute silences a stem outright;
// once anything is soloed, every non-soloed stem goes silent too, without
// touching its own stored gain — a soloed-but-muted stem stays silent.
function appliedGain(gain: number, muted: boolean, soloed: boolean, anySoloed: boolean): number {
  if (muted) return 0;
  if (anySoloed && !soloed) return 0;
  return gain;
}

// The loop region actually in effect (§5.4: loopEnabled is independent of
// the drawn region) — the same rule Player.tsx applies before handing a
// region to Transport.setLoop.
function effectiveLoop(practice: PracticeState): LoopRegion | null {
  return practice.loopEnabled ? practice.loop : null;
}

function sliceToRegion(channels: Float32Array[], region: LoopRegion | null): Float32Array[] {
  if (!region) return channels;
  const length = channels[0].length;
  const start = Math.min(length, Math.max(0, Math.round(region.startSec * SAMPLE_RATE)));
  const end = Math.min(length, Math.max(start, Math.round(region.endSec * SAMPLE_RATE)));
  return channels.map(c => c.slice(start, end));
}

// Sums four already-gain-scaled stereo stems into one. Silent (zero-gain)
// stems are skipped rather than multiplied through, since a muted/solo'd-out
// stem's decoded PCM is otherwise wasted work.
function sumStems(perRole: Record<Role, OfflineMixStem>): Float32Array[] {
  const length = perRole[ROLES[0]].channels[0].length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const role of ROLES) {
    const { channels, gain } = perRole[role];
    if (gain === 0) continue;
    const [l, r] = channels;
    for (let i = 0; i < length; i++) {
      left[i] += l[i] * gain;
      right[i] += r[i] * gain;
    }
  }
  return [left, right];
}

/**
 * Renders the mix's PCM: decodes all four stems, applies gain/mute/solo,
 * and either sums them directly at 1× (sliced to the loop region when one
 * is set) or hands them to the offline stretcher render at the Practice
 * state's tempo.
 */
export async function renderMix(
  song: Song,
  practice: PracticeState,
  solo: Record<Role, boolean>,
  applyTempo: boolean,
  deps: ExportMixDeps = defaultDeps,
): Promise<Float32Array[]> {
  const anySoloed = ROLES.some(role => solo[role]);
  const region = effectiveLoop(practice);

  const decoded = await Promise.all(ROLES.map(async (role) => {
    const stored = await deps.readStem(song.stems[role].path);
    const { channels } = await deps.decodeFlac(stored);
    const stem = practice.stems[role];
    const gain = appliedGain(stem.gain, stem.muted, solo[role], anySoloed);
    return [role, { channels, gain }] as const;
  }));
  const perRole = Object.fromEntries(decoded) as Record<Role, OfflineMixStem>;

  if (!applyTempo) {
    const sliced = Object.fromEntries(
      ROLES.map(role => [role, { channels: sliceToRegion(perRole[role].channels, region), gain: perRole[role].gain }]),
    ) as Record<Role, OfflineMixStem>;
    return sumStems(sliced);
  }

  const startSec = region?.startSec ?? 0;
  const durationSec = region ? region.endSec - region.startSec : song.durationSec;
  return deps.renderMixOffline(perRole, { tempo: practice.tempo, startSec, durationSec });
}

/**
 * Produces the exported mix file: one FLAC or WAV, honouring gain, mute,
 * solo and the loop region, at 1× unless `applyTempo` is set.
 */
export async function exportMix(
  song: Song,
  practice: PracticeState,
  solo: Record<Role, boolean>,
  format: ExportFormat,
  applyTempo: boolean,
  deps: ExportMixDeps = defaultDeps,
): Promise<ExportedMixFile> {
  const channels = await renderMix(song, practice, solo, applyTempo, deps);
  const name = mixFilename(song.title, format);

  if (format === 'flac') {
    const bytes = await encodePcm(channels, SAMPLE_RATE);
    return { name, bytes, mimeType: 'audio/flac' };
  }
  const bytes = encodeWav(channels, SAMPLE_RATE);
  return { name, bytes, mimeType: 'audio/wav' };
}
