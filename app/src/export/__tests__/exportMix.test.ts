import { describe, it, expect, vi } from 'vitest';
import { exportMix, renderMix, type ExportMixDeps } from '../exportMix.ts';
import { decodeFlac, encodePcm, SAMPLE_RATE } from '../../codec/flac.ts';
import { ROLES, defaultPracticeState, type PracticeState, type Role, type Song } from '../../domain/types.ts';
import type { OfflineMixStem } from '../../playback/offlineMix.ts';

const LENGTH = 64;

// Constant-valued, distinct-per-role stems — easy to verify sums by hand,
// unlike a sine fixture where you'd have to re-derive the waveform to check.
const ROLE_LEVEL: Record<Role, number> = { vocals: 0.1, drums: 0.2, bass: 0.3, other: 0.4 };

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-id-1',
    title: 'Test Song',
    durationSec: LENGTH / SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
    createdAt: 0,
    recording: { path: 'recordings/song-id-1', bytes: 1, mimeType: 'audio/mpeg', origin: 'uploaded' },
    stems: {
      vocals: { path: 'stems/song-id-1/vocals.flac', bytes: 1, peaksPath: 'stems/song-id-1/vocals.peaks' },
      drums:  { path: 'stems/song-id-1/drums.flac',  bytes: 1, peaksPath: 'stems/song-id-1/drums.peaks' },
      bass:   { path: 'stems/song-id-1/bass.flac',   bytes: 1, peaksPath: 'stems/song-id-1/bass.peaks' },
      other:  { path: 'stems/song-id-1/other.flac',  bytes: 1, peaksPath: 'stems/song-id-1/other.peaks' },
    },
    practice: defaultPracticeState(),
    ...overrides,
  };
}

async function makeStoredStemBytes(): Promise<Record<Role, Uint8Array>> {
  const entries = await Promise.all(
    ROLES.map(async (role) => {
      const level = ROLE_LEVEL[role];
      const channels = [new Float32Array(LENGTH).fill(level), new Float32Array(LENGTH).fill(level)];
      const bytes = await encodePcm(channels, SAMPLE_RATE);
      return [role, bytes] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Role, Uint8Array>;
}

const NO_SOLO: Record<Role, boolean> = { vocals: false, drums: false, bass: false, other: false };

function makeDeps(stored: Record<Role, Uint8Array>, renderMixOffline?: ExportMixDeps['renderMixOffline']): ExportMixDeps {
  return {
    readStem: async (path: string) => {
      const role = ROLES.find(r => path.includes(r));
      if (!role) throw new Error(`no fixture for path ${path}`);
      return stored[role];
    },
    decodeFlac,
    renderMixOffline: renderMixOffline ?? vi.fn(async () => {
      throw new Error('renderMixOffline should not be called when applyTempo is false');
    }),
  };
}

describe('renderMix — 1x path (applyTempo false)', () => {
  it('sums all four stems at their default gain', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const [left, right] = await renderMix(song, song.practice, NO_SOLO, false, makeDeps(stored));

    const expected = ROLES.reduce((sum, role) => sum + ROLE_LEVEL[role], 0);
    for (let i = 0; i < LENGTH; i++) {
      expect(left[i]).toBeCloseTo(expected, 2);
      expect(right[i]).toBeCloseTo(expected, 2);
    }
  });

  it('honours per-stem gain', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      stems: { ...song.practice.stems, drums: { ...song.practice.stems.drums, gain: 0.5 } },
    };

    const [left] = await renderMix(song, practice, NO_SOLO, false, makeDeps(stored));

    const expected = ROLE_LEVEL.vocals + ROLE_LEVEL.drums * 0.5 + ROLE_LEVEL.bass + ROLE_LEVEL.other;
    expect(left[0]).toBeCloseTo(expected, 2);
  });

  it('honours mute — a muted stem contributes nothing regardless of its gain', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      stems: { ...song.practice.stems, bass: { ...song.practice.stems.bass, muted: true } },
    };

    const [left] = await renderMix(song, practice, NO_SOLO, false, makeDeps(stored));

    const expected = ROLE_LEVEL.vocals + ROLE_LEVEL.drums + ROLE_LEVEL.other;
    expect(left[0]).toBeCloseTo(expected, 2);
  });

  it('honours solo — only the soloed stem contributes, regardless of the others\' own gain/mute', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const solo: Record<Role, boolean> = { ...NO_SOLO, drums: true };

    const [left] = await renderMix(song, song.practice, solo, false, makeDeps(stored));

    expect(left[0]).toBeCloseTo(ROLE_LEVEL.drums, 2);
  });

  it('a soloed stem that is itself muted stays silent, like live playback', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      stems: { ...song.practice.stems, drums: { ...song.practice.stems.drums, muted: true } },
    };
    const solo: Record<Role, boolean> = { ...NO_SOLO, drums: true };

    const [left] = await renderMix(song, practice, solo, false, makeDeps(stored));

    for (let i = 0; i < LENGTH; i++) expect(left[i]).toBeCloseTo(0, 2);
  });

  it('covers only the loop region when one is enabled', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const regionStartSamples = 10;
    const regionEndSamples = 20;
    const practice: PracticeState = {
      ...song.practice,
      loop: { startSec: regionStartSamples / SAMPLE_RATE, endSec: regionEndSamples / SAMPLE_RATE },
      loopEnabled: true,
    };

    const [left] = await renderMix(song, practice, NO_SOLO, false, makeDeps(stored));

    expect(left).toHaveLength(regionEndSamples - regionStartSamples);
  });

  it('ignores a drawn-but-disabled loop region — covers the full Song', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      loop: { startSec: 10 / SAMPLE_RATE, endSec: 20 / SAMPLE_RATE },
      loopEnabled: false,
    };

    const [left] = await renderMix(song, practice, NO_SOLO, false, makeDeps(stored));

    expect(left).toHaveLength(LENGTH);
  });

  it('renders at 1x regardless of the Practice state\'s stored tempo when applyTempo is false', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = { ...song.practice, tempo: 1.8 };

    const [left] = await renderMix(song, practice, NO_SOLO, false, makeDeps(stored));

    expect(left).toHaveLength(LENGTH); // untouched by the stretcher — never called (deps throws if it is)
  });
});

describe('renderMix — apply-tempo path', () => {
  it('delegates to renderMixOffline with the Practice tempo and the full Song when no loop is set', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = { ...song.practice, tempo: 0.6 };

    let received: unknown;
    const renderMixOffline = vi.fn(async (stems: Record<Role, OfflineMixStem>, options: unknown) => {
      received = { stems, options };
      return [new Float32Array([1]), new Float32Array([2])];
    });

    const result = await renderMix(song, practice, NO_SOLO, true, makeDeps(stored, renderMixOffline));

    expect(renderMixOffline).toHaveBeenCalledTimes(1);
    expect((received as { options: { tempo: number; startSec: number; durationSec: number } }).options).toEqual({
      tempo: 0.6, startSec: 0, durationSec: song.durationSec,
    });
    expect(result[0][0]).toBe(1);
    expect(result[1][0]).toBe(2);
  });

  it('passes the loop region as start/duration when one is enabled', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      tempo: 1,
      loop: { startSec: 2, endSec: 5 },
      loopEnabled: true,
    };

    let received: { startSec: number; durationSec: number } | undefined;
    const renderMixOffline = vi.fn(async (_stems: Record<Role, OfflineMixStem>, options: { startSec: number; durationSec: number }) => {
      received = options;
      return [new Float32Array(1), new Float32Array(1)];
    });

    await renderMix(song, practice, NO_SOLO, true, makeDeps(stored, renderMixOffline));

    expect(received).toEqual({ tempo: 1, startSec: 2, durationSec: 3 });
  });

  it('resolves each stem\'s gain (mute/solo honoured) before handing it to renderMixOffline', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      stems: { ...song.practice.stems, bass: { ...song.practice.stems.bass, muted: true } },
    };

    let received: Record<Role, OfflineMixStem> | undefined;
    const renderMixOffline = vi.fn(async (stems: Record<Role, OfflineMixStem>) => {
      received = stems;
      return [new Float32Array(1), new Float32Array(1)];
    });

    await renderMix(song, practice, NO_SOLO, true, makeDeps(stored, renderMixOffline));

    expect(received!.bass.gain).toBe(0);
    expect(received!.vocals.gain).toBe(1);
  });
});

describe('exportMix', () => {
  it('names the file "<title> - mix.<ext>" and matches the format\'s mimeType', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong({ title: 'My Song' });

    const flacFile = await exportMix(song, song.practice, NO_SOLO, 'flac', false, makeDeps(stored));
    expect(flacFile.name).toBe('My Song - mix.flac');
    expect(flacFile.mimeType).toBe('audio/flac');

    const wavFile = await exportMix(song, song.practice, NO_SOLO, 'wav', false, makeDeps(stored));
    expect(wavFile.name).toBe('My Song - mix.wav');
    expect(wavFile.mimeType).toBe('audio/wav');
  });

  it('produces a decodable FLAC file whose content is the honoured mix', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const practice: PracticeState = {
      ...song.practice,
      stems: { ...song.practice.stems, other: { ...song.practice.stems.other, muted: true } },
    };

    const file = await exportMix(song, practice, NO_SOLO, 'flac', false, makeDeps(stored));
    const { channels } = await decodeFlac(file.bytes);

    const expected = ROLE_LEVEL.vocals + ROLE_LEVEL.drums + ROLE_LEVEL.bass;
    expect(channels[0][0]).toBeCloseTo(expected, 2);
  });

  it('produces a canonical WAV file whose content is the honoured mix', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const solo: Record<Role, boolean> = { ...NO_SOLO, vocals: true };

    const file = await exportMix(song, song.practice, solo, 'wav', false, makeDeps(stored));
    const view = new DataView(file.bytes.buffer, file.bytes.byteOffset);
    expect(String.fromCharCode(...file.bytes.subarray(0, 4))).toBe('RIFF');
    const firstSample = view.getInt16(44, true) / 32768;
    expect(firstSample).toBeCloseTo(ROLE_LEVEL.vocals, 2);
  });

  it('does not call renderMixOffline when applyTempo is false', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const renderMixOffline = vi.fn();

    await exportMix(song, song.practice, NO_SOLO, 'flac', false, makeDeps(stored, renderMixOffline));

    expect(renderMixOffline).not.toHaveBeenCalled();
  });

  it('calls renderMixOffline when applyTempo is true', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const renderMixOffline = vi.fn(async () => [new Float32Array(4), new Float32Array(4)]);

    await exportMix(song, song.practice, NO_SOLO, 'flac', true, makeDeps(stored, renderMixOffline));

    expect(renderMixOffline).toHaveBeenCalledTimes(1);
  });
});
