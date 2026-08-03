/**
 * Separation engine — main-thread singleton that manages the worker pool and
 * dispatches queued Separations to free workers.
 *
 * Worker count is memory-bound (one per 4 GB RAM) and never exposed in the UI.
 * Call start() once from main.tsx.
 */

import type { Separation, Song } from '../domain/types.ts';
import { getAllSeparations, putSeparation } from '../storage/db.ts';
import { computeWorkerCount } from './workerCount.ts';

// ─── Public event types ───────────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done';     id: string; song: Song }
  | { type: 'failed';   id: string; error: string | null };

type Listener = (e: EngineEvent) => void;

// ─── Internal state ───────────────────────────────────────────────────────────

interface Slot {
  worker: Worker;
  busy: boolean;
  jobId: string | null;
}

let slots: Slot[] = [];
let pendingIds: string[] = [];
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
 * Notify the engine of a freshly-created Separation so it can dispatch
 * immediately if a worker slot is free.
 */
export function addToQueue(separation: Separation): void {
  pendingIds.push(separation.id);
  dispatch();
}

/**
 * Start the engine.  Reads all queued/running Separations from IDB, resets
 * any interrupted 'running' ones back to 'queued', then creates N workers
 * and starts dispatching.
 */
export async function start(): Promise<void> {
  const all = await getAllSeparations();
  const pending = all.filter(s => s.status === 'queued' || s.status === 'running');

  // Reset interrupted running jobs — they will be restarted from scratch.
  await Promise.all(
    pending
      .filter(s => s.status === 'running')
      .map(s => putSeparation({ ...s, status: 'queued', progress: 0 })),
  );

  pendingIds = pending.map(s => s.id);

  const count = computeWorkerCount();
  for (let i = 0; i < count; i++) {
    const worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' },
    );
    const slot: Slot = { worker, busy: false, jobId: null };

    worker.addEventListener('message', (evt: MessageEvent) => {
      const data = evt.data as {
        msg?: string;
        data?: number;
        type?: string;
        song?: Song;
        error?: string | null;
      };

      if (data?.msg === 'PROGRESS_UPDATE') {
        if (slot.jobId) {
          emit({ type: 'progress', id: slot.jobId, progress: data.data ?? 0 });
        }
        return;
      }

      const id = slot.jobId ?? '';

      if (data?.type === 'done' && data.song) {
        slot.busy = false;
        slot.jobId = null;
        emit({ type: 'done', id, song: data.song });
        dispatch();
      } else if (data?.type === 'failed') {
        slot.busy = false;
        slot.jobId = null;
        emit({ type: 'failed', id, error: data.error ?? null });
        dispatch();
      }
    });

    slots.push(slot);
  }

  dispatch();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function emit(e: EngineEvent): void {
  for (const l of listeners) l(e);
}

function dispatch(): void {
  const freeSlot = slots.find(s => !s.busy);
  if (!freeSlot) return;
  const id = pendingIds.shift();
  if (!id) return;

  // Claim the slot synchronously before the async DB read so a second
  // concurrent dispatch() cannot grab the same slot.
  freeSlot.busy = true;
  freeSlot.jobId = id;

  getAllSeparations().then(all => {
    const sep = all.find(s => s.id === id);
    if (!sep || sep.status === 'failed') {
      freeSlot.busy = false;
      freeSlot.jobId = null;
      dispatch();
      return;
    }
    freeSlot.worker.postMessage({ type: 'run', separation: sep });
  }).catch(() => {
    freeSlot.busy = false;
    freeSlot.jobId = null;
    pendingIds.unshift(id);
  });
}
