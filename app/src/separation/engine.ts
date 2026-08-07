/**
 * Separation engine — main-thread singleton that manages the single running
 * worker and dispatches the queue. Call start() once from main.tsx.
 *
 * One Separation runs at a time; the rest queue. Running two at once is
 * pointless when worker count is memory-bound — two jobs would each get a
 * share of the workers and both would take longer, at higher peak memory —
 * so there is exactly one worker, not a pool sized by device RAM.
 *
 * Every operation that reads-then-writes the catalogue (dispatching,
 * cancelling, retrying, resuming, reordering) runs through a single mutex so
 * two calls arriving close together — a job finishing while the user clicks
 * Cancel, two quick clicks on a reorder arrow — can't interleave their reads
 * and clobber each other's writes.
 */

import type { Separation, Song, SeparationFailureCause } from '../domain/types.ts';
import { getAllSeparations, getSeparation, putSeparation, deleteSeparation } from '../storage/db.ts';
import { deleteSeparationBytes } from '../storage/opfs.ts';
import { orderedQueue, reorderQueue, nextQueueOrder } from './queue.ts';
import { isStalled } from './watchdog.ts';

// ─── Public event types ───────────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done';     id: string; song: Song }
  | { type: 'failed';   separation: Separation }
  | { type: 'removed';  id: string }
  | { type: 'updated';  separation: Separation };

type Listener = (e: EngineEvent) => void;

const WORKER_CRASH_MESSAGE =
  'The separation worker crashed unexpectedly — this usually means the device ran low on memory.';

// A worker can also die without ever throwing — e.g. a hard OOM kill of its
// thread that the browser doesn't surface as a catchable 'error' event — or
// finish and write its outcome to storage while its postMessage back to this
// thread never arrives. Left undetected, either leaves the job (and the
// whole queue behind it, since there's one Slot) stuck forever. See
// pollCurrentJob() below.
const STALL_MESSAGE = 'The separation worker stopped responding and was restarted.';
const STALL_CHECK_INTERVAL_MS = 30 * 1000;

// ─── Internal state ───────────────────────────────────────────────────────────

interface Slot {
  worker: Worker;
  busy: boolean;
  job: Separation | null; // the Separation currently dispatched to this worker
  lastActivityAt: number; // last dispatch or PROGRESS_UPDATE; watchdog basis
}

let current: Slot | null = null;
const listeners = new Set<Listener>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe to engine events.  Returns an unsubscribe function.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify the engine that a freshly-created Separation is in the catalogue so
 * it can dispatch immediately if the single running slot is free.
 */
export function addToQueue(): void {
  dispatch();
}

/**
 * Start the engine.  Reads all queued/running Separations from IDB, reverts
 * any interrupted 'running' one back to 'queued' (marked interrupted, so it
 * waits for an explicit Resume rather than restarting itself), then creates
 * the worker and starts dispatching.
 */
export async function start(): Promise<void> {
  const all = await getAllSeparations();
  const running = all.filter(s => s.status === 'running');

  // Workers die with the page — a Separation still 'running' on load never
  // got to finish. It reverts to queued and is shown as interrupted; the
  // user decides whether to resume, since resuming means starting over.
  await Promise.all(
    running.map(s => putSeparation({ ...s, status: 'queued', progress: 0, interrupted: true })),
  );

  current = createSlot();
  dispatch();
  setInterval(() => { void locked(pollCurrentJob); }, STALL_CHECK_INTERVAL_MS);
}

/**
 * Cancels a running or queued Separation: terminates the worker if it was
 * running this one, then deletes the Separation and its bytes. Leaves
 * nothing behind.
 */
export async function cancel(id: string): Promise<void> {
  await locked(async () => {
    const job = current?.job?.id === id ? current.job : null;
    if (job) terminateSlot();

    const sep = job ?? await getSeparation(id);
    await deleteSeparation(id);
    if (sep) await deleteSeparationBytes(id, sep.uploadPath);

    emit({ type: 'removed', id });
  });
  dispatch();
}

/**
 * Dismisses a failed Separation: deletes it and its retained Recording.
 */
export async function dismiss(id: string): Promise<void> {
  await locked(async () => {
    const sep = await getSeparation(id);
    if (!sep) return;

    await deleteSeparation(id);
    await deleteSeparationBytes(id, sep.uploadPath);
    emit({ type: 'removed', id });
  });
}

/**
 * Retries a failed Separation from scratch, reusing its retained Recording.
 * Joins the back of the queue.
 */
export async function retry(id: string): Promise<void> {
  await locked(async () => {
    const sep = await getSeparation(id);
    if (!sep || sep.status !== 'failed') return;

    const all = await getAllSeparations();
    const updated: Separation = {
      ...sep,
      status: 'queued',
      progress: 0,
      error: null,
      cause: null,
      failedAt: null,
      interrupted: false,
      queueOrder: nextQueueOrder(all),
    };
    await putSeparation(updated);
    emit({ type: 'updated', separation: updated });
  });
  dispatch();
}

/**
 * Resumes an interrupted Separation. Starts over from scratch — there is no
 * mid-inference resume — and joins the back of the queue.
 */
export async function resume(id: string): Promise<void> {
  await locked(async () => {
    const sep = await getSeparation(id);
    if (!sep || !sep.interrupted) return;

    const all = await getAllSeparations();
    const updated: Separation = { ...sep, interrupted: false, queueOrder: nextQueueOrder(all) };
    await putSeparation(updated);
    emit({ type: 'updated', separation: updated });
  });
  dispatch();
}

/**
 * Moves a queued Separation up or down by one position.
 */
export async function reorder(id: string, direction: 'up' | 'down'): Promise<void> {
  await locked(async () => {
    const all = await getAllSeparations();
    const changed = reorderQueue(all, id, direction);
    if (!changed) return;

    await Promise.all(changed.map(s => putSeparation(s)));
    for (const s of changed) emit({ type: 'updated', separation: s });
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emit(e: EngineEvent): void {
  for (const l of listeners) l(e);
}

// Serialises every read-modify-write against the catalogue. A call queued
// while another is in flight simply runs after it — see the module doc.
let mutex: Promise<unknown> = Promise.resolve();

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(() => undefined, () => undefined);
  return run;
}

function createSlot(): Slot {
  const worker = new Worker(
    new URL('./worker.ts', import.meta.url),
    { type: 'module' },
  );
  const slot: Slot = { worker, busy: false, job: null, lastActivityAt: Date.now() };

  worker.addEventListener('message', (evt: MessageEvent) => {
    // Ignore messages from a worker that has since been replaced (e.g. by
    // cancel()) — terminate() may not prevent an already in-flight message.
    if (current !== slot) return;

    const data = evt.data as {
      msg?: string;
      data?: number;
      type?: string;
      song?: Song;
      error?: string;
      cause?: SeparationFailureCause;
      failedAt?: number;
    };

    if (data?.msg === 'PROGRESS_UPDATE') {
      slot.lastActivityAt = Date.now();
      if (slot.job) emit({ type: 'progress', id: slot.job.id, progress: data.data ?? 0 });
      return;
    }

    const job = slot.job;
    slot.busy = false;
    slot.job = null;

    if (data?.type === 'done' && data.song) {
      if (job) emit({ type: 'done', id: job.id, song: data.song });
      dispatch();
    } else if (data?.type === 'failed' && job) {
      const failed: Separation = {
        ...job,
        status: 'failed',
        error: data.error ?? null,
        cause: data.cause ?? 'worker',
        failedAt: data.failedAt ?? Date.now(),
      };
      emit({ type: 'failed', separation: failed });
      dispatch();
    }
  });

  // A worker that dies without posting 'failed' (e.g. an OOM kill) still
  // needs its job reported and its slot replaced with a fresh worker.
  worker.addEventListener('error', () => {
    if (current !== slot) return;
    recoverDeadSlot(slot, 'worker', WORKER_CRASH_MESSAGE);
  });

  return slot;
}

// Shared by the 'error' listener above and pollCurrentJob()'s stall check
// below: both found a worker that will never post 'done'/'failed' on its
// own, so both need the same recovery — drop the job, get a fresh worker
// in, report the failure, and let the queue move on to whatever's next.
function recoverDeadSlot(slot: Slot, cause: SeparationFailureCause, error: string): void {
  const job = slot.job;
  replaceSlot();
  if (!job) return;

  const failed: Separation = {
    ...job,
    status: 'failed',
    error,
    cause,
    failedAt: Date.now(),
  };
  putSeparation(failed).catch(() => undefined);
  emit({ type: 'failed', separation: failed });
  dispatch();
}

// Polled every STALL_CHECK_INTERVAL_MS to catch two ways the in-memory
// engine can drift from what actually happened:
//
// 1. The worker already finished (it writes its own outcome straight to
//    storage — see worker.ts's catch handler) but its postMessage back to
//    this thread never arrived or got dropped. Storage is the source of
//    truth here, so this trusts the persisted row over waiting out a
//    timeout or reconstructing a guess at the failure.
// 2. Nothing — storage nor a message — ever came, i.e. genuine silence.
//    Unlike the 'error' listener, the worker here hasn't necessarily
//    died — it may just be hung — so it's force-terminated before the
//    slot is replaced.
async function pollCurrentJob(): Promise<void> {
  const slot = current;
  if (!slot || !slot.busy || !slot.job) return;
  const job = slot.job;

  const persisted = await getSeparation(job.id);
  // The slot moved on (to a different job, or was replaced entirely) while
  // that read was in flight — whatever we learned is stale, ignore it.
  if (current !== slot || slot.job !== job) return;

  if (persisted?.status === 'failed') {
    slot.busy = false;
    slot.job = null;
    emit({ type: 'failed', separation: persisted });
    dispatch();
    return;
  }

  if (isStalled(slot.lastActivityAt, Date.now())) {
    slot.worker.terminate();
    recoverDeadSlot(slot, 'stalled', STALL_MESSAGE);
  }
}

function terminateSlot(): void {
  current?.worker.terminate();
  replaceSlot();
}

function replaceSlot(): void {
  current = createSlot();
}

function dispatch(): void {
  void locked(dispatchOnce);
}

async function dispatchOnce(): Promise<void> {
  if (!current || current.busy) return; // one Separation runs at a time

  const all = await getAllSeparations();
  const next = orderedQueue(all)[0];
  if (!next) return;

  current.busy = true;
  current.job = next;
  current.lastActivityAt = Date.now();
  current.worker.postMessage({ type: 'run', separation: next });
}
