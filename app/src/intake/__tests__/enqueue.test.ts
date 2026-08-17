/**
 * Intake is where the 7:00 cap is enforced (see length.ts). A refused
 * Recording must leave no OPFS bytes and no catalogue row — per CONTEXT.md a
 * Recording that never lands never becomes a Separation, so there is nothing
 * to clean up later and nothing for the user to dismiss.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Separation, Song } from '../../domain/types.ts';
import { MAX_RECORDING_SEC } from '../length.ts';

let decodedDuration = 200;
const written: string[] = [];
const catalogue = new Map<string, Separation>();

vi.mock('../mobile.ts', () => ({ isMobileUA: () => false }));
vi.mock('../hash.ts', () => ({ hashBytes: () => Promise.resolve('the-id') }));
vi.mock('../space.ts', () => ({ checkSpace: () => Promise.resolve({ ok: true }) }));

vi.mock('../decode.ts', () => ({
  decodeAudio: () => Promise.resolve({ durationSec: decodedDuration }),
  DecodeError: class DecodeError extends Error {},
}));

vi.mock('../../storage/db.ts', () => ({
  getSong: () => Promise.resolve(undefined as Song | undefined),
  getSeparation: (id: string) => Promise.resolve(catalogue.get(id)),
  getAllSeparations: () => Promise.resolve([...catalogue.values()]),
  putSeparation: (s: Separation) => { catalogue.set(s.id, s); return Promise.resolve(); },
}));

vi.mock('../../storage/opfs.ts', () => ({
  writeRecording: (id: string) => { written.push(id); return Promise.resolve(`recordings/${id}`); },
}));

vi.mock('../../separation/model.ts', () => ({ getModelState: () => Promise.resolve('ready') }));

const { enqueue } = await import('../enqueue.ts');

function audioFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'a long song.mp3');
}

describe('enqueue — the length cap', () => {
  beforeEach(() => {
    written.length = 0;
    catalogue.clear();
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } });
  });

  it('queues a Recording under the cap', async () => {
    decodedDuration = 4 * 60;
    const result = await enqueue(audioFile());

    expect(result.kind).toBe('queued');
    expect(written).toEqual(['the-id']);
    expect(catalogue.size).toBe(1);
  });

  it('queues a Recording exactly at the cap', async () => {
    decodedDuration = MAX_RECORDING_SEC;
    expect((await enqueue(audioFile())).kind).toBe('queued');
  });

  it('refuses a Recording past the cap, naming its length', async () => {
    decodedDuration = 8 * 60 + 42;
    const result = await enqueue(audioFile());

    expect(result).toEqual({ kind: 'toolong', durationSec: 8 * 60 + 42 });
  });

  it('leaves no OPFS bytes and no catalogue row behind when it refuses', async () => {
    decodedDuration = 9 * 60;
    await enqueue(audioFile());

    expect(written).toEqual([]);
    expect(catalogue.size).toBe(0);
  });
});
