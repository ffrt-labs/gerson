/**
 * The worker holds its wasm heap for the tab's lifetime — wasm memory never
 * shrinks, and the worker outlives the job that grew it (3.08 GB after one
 * 4-minute song, ~3.98 GB at the 7:00 cap, reclaimed by nothing). So when the
 * queue drains, the worker that ran something is terminated and replaced.
 *
 * Two traps the obvious implementation hits, and the reason `dispatch()`
 * needs a discriminated claim result rather than a nullable job:
 *
 *   1. "no job claimed" has two causes — the genuine drain, and the slot
 *      being busy, which `addToQueue()` hits routinely *while a job runs*.
 *      Recycling on the second one kills running jobs.
 *   2. Without a has-run gate, `start()` → `dispatch()` on an empty queue
 *      terminates the worker it just created, every load.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  catalogue, FakeWorker, dbMock, opfsMock, decodeMock, separation, settle, loadEngine,
} from './engineHarness.ts';

vi.mock('../../storage/db.ts', () => dbMock());
vi.mock('../../storage/opfs.ts', () => opfsMock());
vi.mock('../decode.ts', () => decodeMock());
vi.stubGlobal('Worker', FakeWorker);

describe('recycling the worker when the queue drains', () => {
  beforeEach(() => {
    catalogue.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('does not terminate the freshly-created worker when start() finds an empty queue', async () => {
    await loadEngine();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });

  it('terminates and replaces the worker once the last job completes', async () => {
    catalogue.set('a', separation('a', 1));
    await loadEngine();

    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    expect(worker.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
  });

  it('releases the heap after a failure too', async () => {
    catalogue.set('a', separation('a', 1));
    await loadEngine();

    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'failed', error: 'Aborted()', cause: 'worker', failedAt: 1 });
    await settle();

    expect(worker.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('keeps the same worker when another job is still waiting', async () => {
    catalogue.set('a', separation('a', 1));
    catalogue.set('b', separation('b', 2));
    await loadEngine();

    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    expect(worker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(catalogue.get('b')!.status).toBe('running');
  });

  it('never kills a running job when addToQueue() finds the slot busy', async () => {
    catalogue.set('a', separation('a', 1));
    const engine = await loadEngine();

    const worker = FakeWorker.instances[0];
    engine.addToQueue();
    engine.addToQueue();
    await settle();

    expect(worker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('leaves the replacement worker alone across further empty dispatches', async () => {
    catalogue.set('a', separation('a', 1));
    const engine = await loadEngine();

    FakeWorker.instances[0].emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    engine.addToQueue();
    await settle();

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
  });

  // The intake cap (intake/length.ts) refuses these up front, so the only
  // way one reaches dispatch is a row queued before the cap landed.
  it('fails an over-length row before the worker is handed anything', async () => {
    catalogue.set('a', separation('a', 1, { durationSec: 8 * 60 + 42 }));
    await loadEngine();

    expect(FakeWorker.instances[0].received).toEqual([]);
    // Its own cause: the failed row's advice is driven by cause alone, and
    // 'worker' would tell the user to close some tabs and retry a Recording
    // that can never fit.
    expect(catalogue.get('a')).toMatchObject({ status: 'failed', cause: 'toolong' });
    expect(catalogue.get('a')!.error).toContain('8m 42s');
  });

  it('still dispatches a row at the cap', async () => {
    catalogue.set('a', separation('a', 1, { durationSec: 7 * 60 }));
    await loadEngine();

    expect(FakeWorker.instances[0].received).toHaveLength(1);
    expect(catalogue.get('a')!.status).toBe('running');
  });

  it('does not treat an interrupted row as work worth keeping the heap for', async () => {
    catalogue.set('a', separation('a', 1));
    catalogue.set('b', separation('b', 2, { interrupted: true }));
    await loadEngine();

    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'done', song: { id: 'a', title: 'song a' } });
    await settle();

    expect(worker.terminated).toBe(true);
    expect(catalogue.get('b')!.status).toBe('queued');
  });
});
