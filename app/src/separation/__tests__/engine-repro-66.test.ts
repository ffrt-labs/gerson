/**
 * Reproduction for issue #66 — "What restarts the engine under a running
 * Separation?".
 *
 * The premise turned out to be wrong: nothing restarts the engine. The engine
 * *forgets* the running Separation, because demucs.wasm posts a third kind of
 * message the engine doesn't know about.
 *
 * demucs.js exposes two callbacks to the wasm module:
 *
 *   sendProgressUpdate → postMessage({ msg: 'PROGRESS_UPDATE', data })
 *   callWriteWasmLog   → postMessage({ msg: 'WASM_LOG',        data })
 *
 * engine.ts's message handler special-cases only PROGRESS_UPDATE; every other
 * message falls through to the terminal-message path, which clears
 * `slot.job` and `slot.busy` before checking whether it was actually a
 * 'done'/'failed'. A WASM_LOG therefore orphans the job that is still running.
 *
 * Measured against the real module (10 s of audio, htdemucs 4-source weights):
 * 7 WASM_LOG during _modelInit and 95 during _modelDemixSegment, the first of
 * them ("Beginning Demucs v4 Hybrid-Transformer inference") arriving *before*
 * the first PROGRESS_UPDATE. So the orphaning happens on essentially every run,
 * seconds in.
 *
 * These tests assert the CURRENT (broken) behaviour, so they are red once the
 * fix lands — that is the point; they are evidence for the ticket, not a
 * regression suite.
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

// ─── The reproduction ────────────────────────────────────────────────────────

describe('#66 — a WASM_LOG orphans the running Separation', () => {
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

  it('stops reporting progress after the first WASM_LOG', () => {
    // Real ordering: the log arrives first, then progress starts flowing.
    worker.emit({ msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' });
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.25 });
    worker.emit({ msg: 'PROGRESS_UPDATE', data: 0.5 });

    // The job was cleared by the log, so the progress guard in the handler
    // (`if (slot.job)`) never fires — the UI sits at 0% for the whole run.
    expect(events.filter(e => e.type === 'progress')).toHaveLength(0);
  });

  it('leaves the row stuck at status running, which a later reload turns into interrupted', async () => {
    worker.emit({ msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' });

    // Nothing ever writes this row again: the engine has forgotten the job,
    // and the worker only rewrites it on failure (or deletes it on success).
    expect(catalogue.get('a')!.status).toBe('running');

    // Now the user reloads — an ordinary, unremarkable reload — and start()
    // reverts the row exactly as it was observed in the bug report.
    vi.resetModules();
    const reloaded = await import('../engine.ts');
    await reloaded.start();

    expect(catalogue.get('a')).toMatchObject({ status: 'queued', interrupted: true, progress: 0 });
  });

  it('disarms the stall watchdog, so nothing ever recovers the job', async () => {
    worker.emit({ msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' });

    // Well past STALL_TIMEOUT_MS (5 min) with total silence from the worker.
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await settle();

    // pollCurrentJob() returns at `!slot.busy || !slot.job` before it ever
    // reaches isStalled(), so the job is never failed and never retried.
    expect(worker.terminated).toBe(false);
    expect(events.filter(e => e.type === 'failed')).toHaveLength(0);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('frees the slot, so a second Separation is dispatched into the busy worker', async () => {
    worker.emit({ msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' });

    catalogue.set('b', separation('b', 2));
    engine.addToQueue();
    await settle();

    // Same worker, still synchronously inside _modelDemixSegment for 'a'.
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.received).toHaveLength(2);
    // Two Separations now claim to be running at once.
    expect(catalogue.get('a')!.status).toBe('running');
    expect(catalogue.get('b')!.status).toBe('running');
  });

  it('swallows the eventual done, so the finished Song never reaches the UI', async () => {
    worker.emit({ msg: 'WASM_LOG', data: 'Beginning Demucs v4 Hybrid-Transformer inference' });

    // The worker finishes properly and commits the Song to storage itself.
    worker.emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    // `job` was already null, so no 'done' event is emitted: the library
    // gains a Song the running UI never learns about.
    expect(events.filter(e => e.type === 'done')).toHaveLength(0);
  });
});
