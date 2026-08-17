/**
 * Shared fixture for the engine tests: a fake catalogue, a fake OPFS, a fake
 * decode, and a FakeWorker standing in for the real one so a test can post
 * exactly the messages demucs.js posts.
 *
 * The vi.mock calls have to live in the test file itself — Vitest hoists them
 * to the top of the module that calls them — so each test file declares its
 * mocks and points them at the state here.
 */

import { vi } from 'vitest';
import type { Separation } from '../../domain/types.ts';

/** Stands in for IDB. The mocked storage/db.ts reads and writes this. */
export const catalogue = new Map<string, Separation>();

/** Stands in for the real Worker; lets a test drive the engine's message handler. */
export class FakeWorker {
  static instances: FakeWorker[] = [];
  received: unknown[] = [];
  terminated = false;
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor() { FakeWorker.instances.push(this); }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  postMessage(data: unknown): void { this.received.push(data); }
  terminate(): void { this.terminated = true; }

  /** Deliver a message from the worker to the engine, as demucs would. */
  emit(data: unknown): void {
    for (const fn of this.listeners.get('message') ?? []) fn({ data });
  }
}

/** The mock bodies, so both test files describe the same world. */
export const dbMock = () => ({
  getSeparation: (id: string) => Promise.resolve(catalogue.get(id)),
  putSeparation: (s: Separation) => { catalogue.set(s.id, s); return Promise.resolve(); },
  deleteSeparation: (id: string) => { catalogue.delete(id); return Promise.resolve(); },
  getAllSeparations: () => Promise.resolve([...catalogue.values()]),
});

export const opfsMock = () => ({
  readRecording: () => Promise.resolve(new Uint8Array([1, 2, 3])),
  deleteSeparationBytes: () => Promise.resolve(),
});

export const decodeMock = () => ({
  decodeRecording: () => Promise.resolve({
    left: new Float32Array(8),
    right: new Float32Array(8),
    durationSec: 1,
    recordingBytes: 3,
    recordingMimeType: 'audio/mpeg',
  }),
});

export function separation(
  id: string,
  queueOrder: number,
  overrides: Partial<Separation> = {},
): Separation {
  return {
    id, title: `song ${id}`, durationSec: 231, status: 'queued',
    uploadPath: `uploads/${id}`, progress: 0, error: null, cause: null,
    failedAt: null, startedAt: Date.now(), interrupted: false, queueOrder,
    ...overrides,
  };
}

/** Lets the engine's chain of awaited microtasks settle. */
export const settle = (): Promise<unknown> => new Promise(r => setTimeout(r, 0));

/**
 * Fresh engine module (module state is per-import), started, with its first
 * dispatch settled. Seed `catalogue` before calling.
 */
export async function loadEngine(): Promise<typeof import('../engine.ts')> {
  vi.resetModules();
  FakeWorker.instances.length = 0;
  const engine = await import('../engine.ts');
  await engine.start();
  await settle();
  return engine;
}
