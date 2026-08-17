/**
 * Regression suite for #66 — a Separation that never completes because the
 * engine forgot it.
 *
 * demucs.js posts three message kinds through the wasm module's callbacks:
 *
 *   sendProgressUpdate → { msg: 'PROGRESS_UPDATE',       data: 0..1 }
 *                        { msg: 'PROGRESS_UPDATE_BATCH', data: 0..1 }  (batch mode)
 *   callWriteWasmLog   → { msg: 'WASM_LOG',              data: string }
 *
 * The engine used to special-case only PROGRESS_UPDATE and let everything
 * else fall through to the terminal path, which clears `slot.job`/`slot.busy`
 * before checking whether the message was actually a 'done'/'failed'. Since
 * the wasm posts 7 WASM_LOG during _modelInit and ~95 during inference — the
 * first arriving *before* any progress — every run was orphaned seconds in:
 * the UI froze at 0%, the watchdog disarmed, and a reload turned the stranded
 * 'running' row into an interrupted one.
 *
 * These tests assert the fixed behaviour: terminal handling is reached only
 * by explicit match, so an unrecognised message is inert by construction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Separation } from '../../domain/types.ts';

// ─── Fakes for everything the engine touches outside itself ──────────────────

const catalogue = new Map<string, Separation>();

vi.mock('../../storage/db.ts', () => ({
  getSeparation: (id: string) => Promise.resolve(catalogue.get(id)),
  putSeparation: (s: Separation) => { catalogue.set(s.id, s); return Promise.resolve(); },
  deleteSeparation: (id: string) => { catalogue.delete(id); return Promise.resolve(); },
  getAllSeparations: () => Promise.resolve([...catalogue.values()]),
}));

vi.mock('../../storage/opfs.ts', () => ({
  readRecording: () => Promise.resolve(new Uint8Array([1, 2, 3])),
  deleteSeparationBytes: () => Promise.resolve(),
}));

vi.mock('../decode.ts', () => ({
  decodeRecording: () => Promise.resolve({
    left: new Float32Array(8),
    right: new Float32Array(8),
    durationSec: 1,
    recordingBytes: 3,
    recordingMimeType: 'audio/mpeg',
  }),
}));

/** Stands in for the real Worker; lets a test post the messages demucs posts. */
class FakeWorker {
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

vi.stubGlobal('Worker', FakeWorker);

function separation(id: string, queueOrder: number): Separation {
  return {
    id, title: `song ${id}`, durationSec: 231, status: 'queued',
    uploadPath: `uploads/${id}`, progress: 0, error: null, cause: null,
    failedAt: null, startedAt: Date.now(), interrupted: false, queueOrder,
  };
}

/** Lets the engine's chain of awaited microtasks settle. */
const settle = () => new Promise(r => setTimeout(r, 0));

const WASM_LOG = { msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' };

// ─── The regression ──────────────────────────────────────────────────────────

describe('#66 — an unrecognised worker message cannot end a job', () => {
  let engine: typeof import('../engine.ts');
  let worker: FakeWorker;
  let events: { type: string; id?: string }[];

  beforeEach(async () => {
    catalogue.clear();
    FakeWorker.instances.length = 0;
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    catalogue.set('a', separation('a', 1));

    engine = await import('../engine.ts');
    events = [];
    engine.subscribe(e => { events.push({ type: e.type, id: 'id' in e ? e.id : undefined }); });

    await engine.start();
    await settle();

    worker = FakeWorker.instances[0];
  });

  it('dispatches the job to the worker and marks it running', () => {
    expect(worker.received).toHaveLength(1);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('keeps reporting progress after a WASM_LOG', () => {
    // Real ordering: the log arrives first, then progress starts flowing.
    worker.emit(WASM_LOG);
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.25 });
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.5 });

    expect(events.filter(e => e.type === 'progress')).toHaveLength(2);
  });

  it('ignores PROGRESS_UPDATE_BATCH as a terminal message, and reports it as progress', () => {
    // The second unhandled kind, sitting behind worker.ts's batchMode: false.
    worker.emit({ msg: 'PROGRESS_UPDATE_BATCH', data: 0.4 });
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.75 });

    expect(events.filter(e => e.type === 'progress')).toHaveLength(2);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('ignores a message of a kind nobody has seen yet', () => {
    worker.emit({ msg: 'SOMETHING_NEW', data: 1 });
    worker.emit({ type: 'not-a-real-outcome' });
    worker.emit(null);
    worker.emit('a bare string');
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.5 });

    expect(events.filter(e => e.type === 'progress')).toHaveLength(1);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('coalesces progress to whole percent, so 3.6 messages/s do not drive 3.6 renders/s', () => {
    for (let i = 0; i < 20; i++) {
      worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.5 + i * 0.0001 });
    }
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.51 });

    // 0.5000–0.5019 all round to 50%: one event, then one more for 51%.
    expect(events.filter(e => e.type === 'progress')).toHaveLength(2);
  });

  it('keeps the stall watchdog armed, so a genuinely silent worker is still recovered', async () => {
    worker.emit(WASM_LOG);

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await settle();

    expect(worker.terminated).toBe(true);
    expect(events.filter(e => e.type === 'failed')).toHaveLength(1);
    expect(catalogue.get('a')).toMatchObject({ status: 'failed', cause: 'stalled' });
  });

  it('does not free the slot, so a second Separation waits its turn', async () => {
    worker.emit(WASM_LOG);

    catalogue.set('b', separation('b', 2));
    engine.addToQueue();
    await settle();

    expect(worker.received).toHaveLength(1);
    expect(catalogue.get('a')!.status).toBe('running');
    expect(catalogue.get('b')!.status).toBe('queued');
  });

  it('still delivers the eventual done to the UI', async () => {
    worker.emit(WASM_LOG);
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.99 });
    worker.emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    expect(events.filter(e => e.type === 'done')).toEqual([{ type: 'done', id: 'a' }]);
  });

  it('still delivers the eventual failed to the UI', async () => {
    worker.emit(WASM_LOG);
    worker.emit({ type: 'failed', error: 'Aborted()', cause: 'worker', failedAt: 123 });
    await settle();

    expect(events.filter(e => e.type === 'failed')).toHaveLength(1);
  });
});
