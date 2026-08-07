import { describe, it, expect } from 'vitest';
import { exportStems, type ExportStemsDeps } from '../exportStems.ts';
import { decodeFlac, encodePcm, SAMPLE_RATE } from '../../codec/flac.ts';
import { EXPORT_SCHEMA_VERSION } from '../tags.ts';
import { ROLES, defaultPracticeState, type Role, type Song } from '../../domain/types.ts';

function makeSineFixture(samples = 512): Float32Array[] {
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    right[i] = Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE);
  }
  return [left, right];
}

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-id-1',
    title: 'Test Song',
    durationSec: 1,
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

// Real stems, as they'd sit on OPFS: encoded once, with the storage-internal
// tags separation/worker.ts writes (ROLE upper-case, ID) — export must
// override these, not add to them.
async function makeStoredStemBytes(): Promise<Record<Role, Uint8Array>> {
  const entries = await Promise.all(
    ROLES.map(async (role) => {
      const fixture = makeSineFixture(256 + ROLES.indexOf(role) * 16); // distinct per-role content
      const bytes = await encodePcm(fixture, SAMPLE_RATE, { ROLE: role.toUpperCase(), ID: 'song-id-1' });
      return [role, bytes] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Role, Uint8Array>;
}

function makeDeps(stored: Record<Role, Uint8Array>): ExportStemsDeps {
  return {
    readStem: async (path: string) => {
      const role = ROLES.find(r => path.includes(r));
      if (!role) throw new Error(`no fixture for path ${path}`);
      return stored[role];
    },
    decodeFlac,
  };
}

describe('exportStems', () => {
  it('produces exactly four files, one per Role, in domain order', async () => {
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const files = await exportStems(song, 'flac', makeDeps(stored));

    expect(files).toHaveLength(4);
    expect(files.map(f => f.role)).toEqual(ROLES);
  });

  describe('FLAC format', () => {
    it('names files "<title> - <role>.flac" and sets audio/flac', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong({ title: 'My Song' });
      const files = await exportStems(song, 'flac', makeDeps(stored));

      expect(files[0].name).toBe('My Song - vocals.flac');
      expect(files.every(f => f.mimeType === 'audio/flac')).toBe(true);
    });

    it('carries role, song id, schema version and title as Vorbis comments', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong({ id: 'abc', title: 'Tagged' });
      const files = await exportStems(song, 'flac', makeDeps(stored));

      for (const file of files) {
        const { tags } = await decodeFlac(file.bytes);
        expect(tags['ROLE']).toBe(file.role);
        expect(tags['SONG_ID']).toBe('abc');
        expect(tags['SCHEMA_VERSION']).toBe(EXPORT_SCHEMA_VERSION);
        expect(tags['TITLE']).toBe('Tagged');
        // Storage-internal tags must not leak into the exported artifact.
        expect(tags['ID']).toBeUndefined();
      }
    });

    it('is bit-identical to the stored stem, only the tags differ', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong();
      const files = await exportStems(song, 'flac', makeDeps(stored));

      for (const file of files) {
        const before = await decodeFlac(stored[file.role]);
        const after = await decodeFlac(file.bytes);
        expect(after.channels[0].length).toBe(before.channels[0].length);
        for (let ch = 0; ch < 2; ch++) {
          for (let i = 0; i < before.channels[ch].length; i++) {
            expect(after.channels[ch][i]).toBe(before.channels[ch][i]);
          }
        }
      }
    });
  });

  describe('WAV format', () => {
    it('names files "<title> - <role>.wav" and sets audio/wav', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong({ title: 'My Song' });
      const files = await exportStems(song, 'wav', makeDeps(stored));

      expect(files[0].name).toBe('My Song - vocals.wav');
      expect(files.every(f => f.mimeType === 'audio/wav')).toBe(true);
    });

    it('produces a valid canonical WAV header', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong();
      const files = await exportStems(song, 'wav', makeDeps(stored));

      const view = new DataView(files[0].bytes.buffer, files[0].bytes.byteOffset);
      expect(String.fromCharCode(...files[0].bytes.subarray(0, 4))).toBe('RIFF');
      expect(String.fromCharCode(...files[0].bytes.subarray(8, 12))).toBe('WAVE');
      expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    });

    it('decodes to audio matching the stored stem within FLAC quantisation', async () => {
      const stored = await makeStoredStemBytes();
      const song = makeSong();
      const files = await exportStems(song, 'wav', makeDeps(stored));

      const { channels: before } = await decodeFlac(stored['drums']);
      const wavFile = files.find(f => f.role === 'drums')!;
      const dataView = new DataView(wavFile.bytes.buffer, wavFile.bytes.byteOffset);
      const sampleAt = (i: number, ch: number) =>
        dataView.getInt16(44 + (i * 2 + ch) * 2, true) / 32768;

      for (let i = 0; i < before[0].length; i++) {
        expect(Math.abs(sampleAt(i, 0) - before[0][i])).toBeLessThanOrEqual(1 / 32768);
        expect(Math.abs(sampleAt(i, 1) - before[1][i])).toBeLessThanOrEqual(1 / 32768);
      }
    });
  });

  it('produces identical audio content regardless of format chosen for tagging purposes only', async () => {
    // Both formats must derive from the same stored stem — this is the
    // "neutral" guarantee (§6.1): export never depends on mute/solo/gain,
    // which never even enter this module's inputs.
    const stored = await makeStoredStemBytes();
    const song = makeSong();
    const flacFiles = await exportStems(song, 'flac', makeDeps(stored));
    const wavFiles = await exportStems(song, 'wav', makeDeps(stored));

    expect(flacFiles.map(f => f.role)).toEqual(wavFiles.map(f => f.role));
  });
});
