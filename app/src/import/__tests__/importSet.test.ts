import { describe, it, expect } from 'vitest';
import { prepareImport, commitImport, deriveImportTitle, type ImportDeps, type RawFile } from '../importSet.ts';
import type { DecodedCandidate } from '../decodeCandidate.ts';
import { encodePcm, decodeFlac, SAMPLE_RATE } from '../../codec/flac.ts';
import { hashBytes } from '../../intake/hash.ts';
import { computePeaks } from '../../separation/peaks.ts';
import { ROLES, type Role, type Song, type Separation } from '../../domain/types.ts';

// ─── Test harness ───────────────────────────────────────────────────────────

interface Harness {
  deps: ImportDeps;
  calls: string[];
  songs: Map<string, Song>;
  separations: Map<string, Separation>;
  writtenRecordings: Map<string, Uint8Array>;
  writtenStems: Map<string, Uint8Array>; // key `${id}:${role}`
}

function makeHarness(decodeByBytes: Map<Uint8Array, DecodedCandidate> = new Map()): Harness {
  const calls: string[] = [];
  const songs = new Map<string, Song>();
  const separations = new Map<string, Separation>();
  const writtenRecordings = new Map<string, Uint8Array>();
  const writtenStems = new Map<string, Uint8Array>();

  const deps: ImportDeps = {
    getSong: async (id: string) => { calls.push(`getSong:${id}`); return songs.get(id); },
    getSeparation: async (id: string) => { calls.push(`getSeparation:${id}`); return separations.get(id); },
    putSong: async (song: Song) => { calls.push(`putSong:${song.id}`); songs.set(song.id, song); },
    writeRecording: async (id: string, bytes: Uint8Array) => {
      calls.push(`writeRecording:${id}`);
      writtenRecordings.set(id, bytes);
      return `recordings/${id}`;
    },
    writeStem: async (id: string, role: Role, bytes: Uint8Array) => {
      calls.push(`writeStem:${id}:${role}`);
      writtenStems.set(`${id}:${role}`, bytes);
    },
    writePeaks: async (id: string, role: Role) => { calls.push(`writePeaks:${id}:${role}`); },
    decodeCandidate: async (bytes: Uint8Array) => {
      const found = decodeByBytes.get(bytes);
      if (!found) throw new Error('no fixture registered for these bytes');
      return found;
    },
    encodePcm,
    hashBytes,
    computePeaks,
    checkSpace: async (recordingBytes: number) => { calls.push('checkSpace'); return { ok: true, needsBytes: recordingBytes }; },
    persist: async () => { calls.push('persist'); return true; },
  };

  return { deps, calls, songs, separations, writtenRecordings, writtenStems };
}

function pcm(length: number, value: number): DecodedCandidate {
  return { left: new Float32Array(length).fill(value), right: new Float32Array(length).fill(value), durationSec: length / SAMPLE_RATE };
}

function rawFile(name: string, bytes = new Uint8Array([1, 2, 3])): RawFile {
  return { name, bytes };
}

async function taggedFlacFile(role: Role, songId: string, title = 'My Song'): Promise<RawFile> {
  const bytes = await encodePcm([new Float32Array([0.1]), new Float32Array([0.1])], SAMPLE_RATE, {
    ROLE: role, SONG_ID: songId, SCHEMA_VERSION: '1', TITLE: title,
  });
  return { name: `${role}.flac`, bytes };
}

const ROLE_LEVEL: Record<Role, number> = { vocals: 0.1, drums: 0.2, bass: 0.3, other: 0.4 };

// ─── prepareImport — file-count classification ─────────────────────────────

describe('prepareImport — file count', () => {
  it('redirects a single file to separation rather than treating it as a partial set', async () => {
    const { deps } = makeHarness();
    const file = rawFile('song.mp3');
    const result = await prepareImport([file], deps);
    expect(result).toEqual({ kind: 'redirect', file });
  });

  it('refuses a partial set (2 of 4)', async () => {
    const { deps } = makeHarness();
    const result = await prepareImport([rawFile('a.wav'), rawFile('b.wav')], deps);
    expect(result).toEqual({ kind: 'refuse-partial', count: 2 });
  });

  it('refuses more than four files', async () => {
    const { deps } = makeHarness();
    const files = Array.from({ length: 5 }, (_, i) => rawFile(`f${i}.wav`));
    const result = await prepareImport(files, deps);
    expect(result).toEqual({ kind: 'refuse-partial', count: 5 });
  });

  it('refuses a set with two files sharing the same name (e.g. two folders flattened by unzip)', async () => {
    const { deps } = makeHarness();
    const files = [rawFile('vocals.wav'), rawFile('drums.wav'), rawFile('drums.wav'), rawFile('other.wav')];
    const result = await prepareImport(files, deps);
    expect(result).toEqual({ kind: 'duplicate-names', names: ['drums.wav'] });
  });
});

// ─── prepareImport — tagged sets ────────────────────────────────────────────

describe('prepareImport — tagged sets', () => {
  it('opens the existing Song without decoding anything, when the tagged id is already in the library', async () => {
    const files = await Promise.all(ROLES.map(role => taggedFlacFile(role, 'known-id')));
    const { deps, songs, calls } = makeHarness();
    songs.set('known-id', { id: 'known-id', title: 'Already Here' } as Song);

    const result = await prepareImport(files, deps);

    expect(result).toEqual({ kind: 'exists', id: 'known-id', title: 'Already Here' });
    expect(calls.some(c => c.startsWith('getSong'))).toBe(true);
    // decodeCandidate was never registered for these bytes — if it had been
    // called, the harness's fake would throw "no fixture registered".
  });

  it('reports inflight without decoding, when the tagged id matches a running Separation', async () => {
    const files = await Promise.all(ROLES.map(role => taggedFlacFile(role, 'running-id')));
    const { deps, separations } = makeHarness();
    separations.set('running-id', { id: 'running-id', title: 'Still Separating' } as Separation);

    const result = await prepareImport(files, deps);

    expect(result).toEqual({ kind: 'inflight', id: 'running-id', title: 'Still Separating' });
  });

  it('does not treat a matching failed Separation as inflight — import is its recovery path', async () => {
    const files = await Promise.all(ROLES.map(role => taggedFlacFile(role, 'failed-id', 'Recovered Title')));
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, ROLE_LEVEL[ROLES[i]])] as const),
    );
    const { deps, separations } = makeHarness(decodeByBytes);
    separations.set('failed-id', { id: 'failed-id', title: 'Old Attempt', status: 'failed' } as Separation);

    const result = await prepareImport(files, deps);

    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.song.id).toBe('failed-id');
  });

  it('commits directly (no mapping step) for a fresh tagged set, adopting the embedded id and title', async () => {
    const files = await Promise.all(ROLES.map(role => taggedFlacFile(role, 'fresh-id', 'Tagged Title')));
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, ROLE_LEVEL[ROLES[i]])] as const),
    );
    const { deps, songs } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);

    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.song.id).toBe('fresh-id');
    expect(result.song.title).toBe('Tagged Title');
    expect(result.song.recording.origin).toBe('summed');
    expect(songs.get('fresh-id')).toBe(result.song);
  });

  it('falls back to needs-mapping when tags are inconsistent (disagreeing SONG_ID)', async () => {
    const files = await Promise.all([
      taggedFlacFile('vocals', 'id-a'),
      taggedFlacFile('drums', 'id-b'), // different id — untrustworthy as a set
      taggedFlacFile('bass', 'id-a'),
      taggedFlacFile('other', 'id-a'),
    ]);
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, ROLE_LEVEL[ROLES[i]])] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    expect(result.kind).toBe('needs-mapping');
  });

  it('falls back to needs-mapping when two files share the same ROLE tag', async () => {
    const files = await Promise.all([
      taggedFlacFile('vocals', 'dup-role-id'),
      taggedFlacFile('vocals', 'dup-role-id'), // duplicate role
      taggedFlacFile('bass', 'dup-role-id'),
      taggedFlacFile('other', 'dup-role-id'),
    ]);
    files[1] = { ...files[1], name: 'vocals-2.flac' }; // distinct filename — this test targets the ROLE-tag collision, not the filename one

    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, 0.1 * (i + 1))] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    expect(result.kind).toBe('needs-mapping');
  });
});

// ─── prepareImport — untagged sets ──────────────────────────────────────────

describe('prepareImport — untagged sets', () => {
  it('requests mapping, with prefill for an unambiguous filename match', async () => {
    const files = [
      rawFile('vocals.wav'), rawFile('drums.wav'), rawFile('bass.wav'), rawFile('other.wav'),
    ];
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, ROLE_LEVEL[ROLES[i]])] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);

    expect(result.kind).toBe('needs-mapping');
    if (result.kind !== 'needs-mapping') throw new Error('expected needs-mapping');
    expect(result.candidates.map(c => c.prefillRole)).toEqual(['vocals', 'drums', 'bass', 'other']);
    expect(result.candidates.map(c => c.name)).toEqual(files.map(f => f.name));
    expect(Object.keys(result.decoded)).toEqual(files.map(f => f.name));
  });

  it('requests mapping with no prefill when filenames give no unambiguous hint', async () => {
    const files = [rawFile('t1.wav'), rawFile('t2.wav'), rawFile('t3.wav'), rawFile('t4.wav')];
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map(f => [f.bytes, pcm(64, 0.1)] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    if (result.kind !== 'needs-mapping') throw new Error('expected needs-mapping');
    expect(result.candidates.every(c => c.prefillRole === null)).toBe(true);
  });

  it('derives a title by stripping our own "<title> - <role>" filename convention', async () => {
    const files = [
      rawFile('Cool Song - vocals.wav'), rawFile('Cool Song - drums.wav'),
      rawFile('Cool Song - bass.wav'), rawFile('Cool Song - other.wav'),
    ];
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, pcm(64, ROLE_LEVEL[ROLES[i]])] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    if (result.kind !== 'needs-mapping') throw new Error('expected needs-mapping');
    expect(result.title).toBe('Cool Song');
  });
});

// ─── prepareImport — decode and length validation ──────────────────────────

describe('prepareImport — decode failure', () => {
  it('rejects naming the file that failed to decode', async () => {
    const files = [rawFile('a.wav'), rawFile('bad.wav'), rawFile('c.wav'), rawFile('d.wav')];
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>([
      [files[0].bytes, pcm(64, 0.1)],
      [files[2].bytes, pcm(64, 0.1)],
      [files[3].bytes, pcm(64, 0.1)],
    ]);
    const deps: ImportDeps = {
      ...makeHarness(decodeByBytes).deps,
      decodeCandidate: async (bytes) => {
        if (bytes === files[1].bytes) throw new Error("Firefox couldn't decode this file.");
        const found = decodeByBytes.get(bytes);
        if (!found) throw new Error('unexpected bytes in test');
        return found;
      },
    };

    const result = await prepareImport(files, deps);
    expect(result).toEqual({ kind: 'decode-failed', name: 'bad.wav', message: "Firefox couldn't decode this file." });
  });
});

describe('prepareImport — length spread', () => {
  it('rejects a spread greater than 1 second, reporting all four durations', async () => {
    const files = [rawFile('a.wav'), rawFile('b.wav'), rawFile('c.wav'), rawFile('d.wav')];
    const durations = [10, 10, 10, 11.5]; // > 1s spread
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, { left: new Float32Array(1), right: new Float32Array(1), durationSec: durations[i] }] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    expect(result.kind).toBe('refuse-length');
    if (result.kind !== 'refuse-length') throw new Error('expected refuse-length');
    expect(result.durations).toEqual(files.map((f, i) => ({ name: f.name, durationSec: durations[i] })));
  });

  it('accepts a spread of exactly 1 second (inclusive) and proceeds to mapping', async () => {
    const files = [rawFile('a.wav'), rawFile('b.wav'), rawFile('c.wav'), rawFile('d.wav')];
    const durations = [10, 10, 10, 11]; // exactly 1s spread
    const decodeByBytes = new Map<Uint8Array, DecodedCandidate>(
      files.map((f, i) => [f.bytes, { left: new Float32Array(1), right: new Float32Array(1), durationSec: durations[i] }] as const),
    );
    const { deps } = makeHarness(decodeByBytes);

    const result = await prepareImport(files, deps);
    expect(result.kind).toBe('needs-mapping');
  });
});

// ─── commitImport — synthesis and identity ─────────────────────────────────

describe('commitImport', () => {
  function makeByRole(length = 64): Record<Role, DecodedCandidate> {
    return Object.fromEntries(ROLES.map(role => [role, pcm(length, ROLE_LEVEL[role])])) as Record<Role, DecodedCandidate>;
  }

  it('sums the four stems into a Recording with origin "summed"', async () => {
    const { deps } = makeHarness();
    const result = await commitImport(makeByRole(), 'My Import', null, deps);

    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.song.recording.origin).toBe('summed');
  });

  it('the synthesised Recording decodes to the exact sum of the four stems', async () => {
    const harness = makeHarness();
    const result = await commitImport(makeByRole(64), 'My Import', null, harness.deps);
    if (result.kind !== 'imported') throw new Error('expected imported');

    const recordingBytes = harness.writtenRecordings.get(result.song.id)!;
    const { channels } = await decodeFlac(recordingBytes);
    const expectedSum = ROLES.reduce((sum, role) => sum + ROLE_LEVEL[role], 0);
    expect(channels[0][0]).toBeCloseTo(expectedSum, 3);
  });

  it('each written stem is tagged with its Role and the final id', async () => {
    const harness = makeHarness();
    const result = await commitImport(makeByRole(64), 'My Import', null, harness.deps);
    if (result.kind !== 'imported') throw new Error('expected imported');

    for (const role of ROLES) {
      const bytes = harness.writtenStems.get(`${result.song.id}:${role}`)!;
      const { tags, channels } = await decodeFlac(bytes);
      expect(tags['ROLE']).toBe(role.toUpperCase());
      expect(tags['ID']).toBe(result.song.id);
      expect(channels[0][0]).toBeCloseTo(ROLE_LEVEL[role], 3);
    }
  });

  it('uses the preset id (from tags) rather than hashing, when one is given', async () => {
    const { deps } = makeHarness();
    const result = await commitImport(makeByRole(), 'My Import', 'explicit-id', deps);
    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.song.id).toBe('explicit-id');
  });

  it('pads shorter stems with silence to the longest before summing', async () => {
    const byRole = makeByRole(64);
    byRole.bass = pcm(60, ROLE_LEVEL.bass); // 4 samples short — within tolerance elsewhere, but here we test padding directly
    const harness = makeHarness();

    const result = await commitImport(byRole, 'My Import', null, harness.deps);
    if (result.kind !== 'imported') throw new Error('expected imported');

    expect(result.song.durationSec).toBeCloseTo(64 / SAMPLE_RATE, 6);
    const recordingBytes = harness.writtenRecordings.get(result.song.id)!;
    const { channels } = await decodeFlac(recordingBytes);
    expect(channels[0]).toHaveLength(64);
    // Tail samples (past bass's own 60) still sum vocals+drums+other, minus bass's silence.
    const expectedTail = ROLE_LEVEL.vocals + ROLE_LEVEL.drums + ROLE_LEVEL.other;
    expect(channels[0][63]).toBeCloseTo(expectedTail, 3);
  });

  it('does not write anything to OPFS or IDB when the derived id already exists (untagged duplicate)', async () => {
    const harness = makeHarness();
    // First commit establishes the id.
    const first = await commitImport(makeByRole(), 'My Import', null, harness.deps);
    if (first.kind !== 'imported') throw new Error('expected imported');
    harness.calls.length = 0; // reset call log

    // Re-importing the exact same four stems must hash to the same id and stop before any write.
    const second = await commitImport(makeByRole(), 'My Import', null, harness.deps);

    expect(second).toEqual({ kind: 'exists', song: first.song });
    expect(harness.calls.some(c => c.startsWith('writeRecording') || c.startsWith('writeStem'))).toBe(false);
    expect(harness.calls.some(c => c.startsWith('putSong'))).toBe(false);
  });

  it('refuses up front, without writing anything, when there is not enough storage', async () => {
    const harness = makeHarness();
    const deps: ImportDeps = {
      ...harness.deps,
      checkSpace: async (recordingBytes: number) => ({ ok: false, needsBytes: recordingBytes + 1000 }),
    };

    const result = await commitImport(makeByRole(), 'My Import', null, deps);

    expect(result.kind).toBe('nospace');
    if (result.kind !== 'nospace') throw new Error('expected nospace');
    expect(result.needsBytes).toBeGreaterThan(0);
    expect(harness.calls.some(c => c.startsWith('writeRecording') || c.startsWith('writeStem'))).toBe(false);
    expect(harness.calls.some(c => c.startsWith('putSong'))).toBe(false);
  });

  it('requests persistent storage after the first write', async () => {
    const harness = makeHarness();
    await commitImport(makeByRole(), 'My Import', null, harness.deps);
    expect(harness.calls).toContain('persist');
  });

  it('reports inflight, without writing, when the derived id matches a running Separation', async () => {
    const harness = makeHarness();
    // Precompute what the id will be by running the real hash over the expected recording bytes.
    const probe = await commitImport(makeByRole(), 'probe', null, {
      ...harness.deps,
      writeRecording: async () => 'unused',
      writeStem: async () => undefined,
      writePeaks: async () => undefined,
      putSong: async () => undefined,
    });
    if (probe.kind !== 'imported') throw new Error('expected imported');
    harness.separations.set(probe.song.id, { id: probe.song.id, title: 'Busy' } as Separation);

    const result = await commitImport(makeByRole(), 'My Import', null, harness.deps);

    expect(result).toEqual({ kind: 'inflight', id: probe.song.id, title: 'Busy' });
    expect(harness.calls.some(c => c.startsWith('writeRecording'))).toBe(false);
  });

  it('writes OPFS (recording, then stems+peaks) before the catalogue row', async () => {
    const harness = makeHarness();
    await commitImport(makeByRole(), 'My Import', null, harness.deps);

    const putSongIndex = harness.calls.findIndex(c => c.startsWith('putSong'));
    const writeRecordingIndex = harness.calls.findIndex(c => c.startsWith('writeRecording'));
    const writeStemIndices = harness.calls
      .map((c, i) => (c.startsWith('writeStem') ? i : -1))
      .filter(i => i !== -1);

    expect(writeRecordingIndex).toBeGreaterThanOrEqual(0);
    expect(putSongIndex).toBeGreaterThan(writeRecordingIndex);
    for (const i of writeStemIndices) expect(putSongIndex).toBeGreaterThan(i);
  });

  it('falls back to "Imported song" for a blank title', async () => {
    const { deps } = makeHarness();
    const result = await commitImport(makeByRole(), '   ', null, deps);
    if (result.kind !== 'imported') throw new Error('expected imported');
    expect(result.song.title).toBe('Imported song');
  });
});

describe('deriveImportTitle', () => {
  it('strips a role suffix in our own naming convention', () => {
    expect(deriveImportTitle(['My Song - vocals.flac', 'x', 'y', 'z'])).toBe('My Song');
    expect(deriveImportTitle(['track_vox.wav'])).toBe('track');
  });

  it('falls back to "Imported song" when nothing usable remains', () => {
    expect(deriveImportTitle(['vocals.wav'])).toBe('Imported song');
    expect(deriveImportTitle([])).toBe('Imported song');
  });
});
