/**
 * Separation engine — main-thread singleton that manages the worker pool and
 * dispatches the queue. Call start() once from main.tsx.
 *
 * One Separation runs at a time; the rest queue. Running two at once is
 * pointless when worker count is memory-bound — two jobs would each get a
 * share of the workers and both would take longer, at higher peak memory —
 * so dispatch never lets more than one slot be busy, even though the pool
 * itself is sized larger. Worker count is memory-bound and never exposed in
 * the UI.
 */

import type { Separation, Song, SeparationFailureCause } from '../domain/types.ts';
import { getAllSeparations, getSeparation, putSeparation, deleteSeparation } from '../storage/db.ts';
import { deleteSeparationBytes } from '../storage/opfs.ts';
import { computeWorkerCount } from './workerCount.ts';
import { orderedQueue, reorderQueue, nextQueueOrder } from './queue.ts';

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

// ─── Internal state ───────────────────────────────────────────────────────────

interface Slot {
  worker: Worker;
  busy: boolean;
  job: Separation | null; // the Separation currently dispatched to this slot
}

const slots: Slot[] = [];
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
 * the worker pool and starts dispatching.
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

  const count = computeWorkerCount();
  for (let i = 0; i < count; i++) {
    slots.push(createSlot());
  }

  dispatch();
}

/**
 * Cancels a running or queued Separation: terminates its worker if running,
 * then deletes the Separation and its bytes. Leaves nothing behind.
 */
export async function cancel(id: string): Promise<void> {
  const slot = slots.find(s => s.job?.id === id);
  const job = slot?.job ?? null;
  if (slot) terminateSlot(slot);

  const sep = job ?? await getSeparation(id);
  await deleteSeparation(id);
  if (sep) await deleteSeparationBytes(id, sep.uploadPath);

  emit({ type: 'removed', id });
  dispatch();
}

/**
 * Dismisses a failed Separation: deletes it and its retained Recording.
 */
export async function dismiss(id: string): Promise<void> {
  const sep = await getSeparation(id);
  if (!sep) return;

  await deleteSeparation(id);
  await deleteSeparationBytes(id, sep.uploadPath);
  emit({ type: 'removed', id });
}

/**
 * Retries a failed Separation from scratch, reusing its retained Recording.
 * Joins the back of the queue.
 */
export async function retry(id: string): Promise<void> {
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
  dispatch();
}

/**
 * Resumes an interrupted Separation. Starts over from scratch — there is no
 * mid-inference resume — and joins the back of the queue.
 */
export async function resume(id: string): Promise<void> {
  const sep = await getSeparation(id);
  if (!sep || !sep.interrupted) return;

  const all = await getAllSeparations();
  const updated: Separation = { ...sep, interrupted: false, queueOrder: nextQueueOrder(all) };
  await putSeparation(updated);
  emit({ type: 'updated', separation: updated });
  dispatch();
}

/**
 * Moves a queued Separation up or down by one position.
 */
export async function reorder(id: string, direction: 'up' | 'down'): Promise<void> {
  const all = await getAllSeparations();
  const changed = reorderQueue(all, id, direction);
  if (!changed) return;

  await Promise.all(changed.map(s => putSeparation(s)));
  for (const s of changed) emit({ type: 'updated', separation: s });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emit(e: EngineEvent): void {
  for (const l of listeners) l(e);
}

function createSlot(): Slot {
  const worker = new Worker(
    new URL('./worker.ts', import.meta.url),
    { type: 'module' },
  );
  const slot: Slot = { worker, busy: false, job: null };

  worker.addEventListener('message', (evt: MessageEvent) => {
    // Ignore messages from a worker that has since been replaced (e.g. by
    // cancel()) — terminate() may not prevent an already in-flight message.
    if (!slots.includes(slot)) return;

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
    if (!slots.includes(slot)) return;

    const job = slot.job;
    replaceSlot(slot);
    if (!job) return;

    const failed: Separation = {
      ...job,
      status: 'failed',
      error: WORKER_CRASH_MESSAGE,
      cause: 'worker',
      failedAt: Date.now(),
    };
    putSeparation(failed).catch(() => undefined);
    emit({ type: 'failed', separation: failed });
    dispatch();
  });

  return slot;
}

function terminateSlot(slot: Slot): void {
  slot.worker.terminate();
  replaceSlot(slot);
}

function replaceSlot(slot: Slot): void {
  const index = slots.indexOf(slot);
  if (index === -1) return;
  slots[index] = createSlot();
}

let dispatchRunning = false;
let dispatchDirty = false;

function dispatch(): void {
  void runDispatch();
}

// Serialises dispatchOnce() calls so two events arriving close together
// (e.g. addToQueue and a job finishing) can't both claim the single slot.
async function runDispatch(): Promise<void> {
  if (dispatchRunning) {
    dispatchDirty = true;
    return;
  }
  dispatchRunning = true;
  try {
    do {
      dispatchDirty = false;
      await dispatchOnce();
    } while (dispatchDirty);
  } finally {
    dispatchRunning = false;
  }
}

async function dispatchOnce(): Promise<void> {
  if (slots.some(s => s.busy)) return; // one Separation runs at a time
  const freeSlot = slots.find(s => !s.busy);
  if (!freeSlot) return;

  const all = await getAllSeparations();
  const next = orderedQueue(all)[0];
  if (!next) return;

  freeSlot.busy = true;
  freeSlot.job = next;
  freeSlot.worker.postMessage({ type: 'run', separation: next });
}
