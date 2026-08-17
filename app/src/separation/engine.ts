/**
 * Separation engine — main-thread singleton that manages the single running
 * worker and dispatches the queue. Call start() once from main.tsx.
 *
 * One Separation runs at a time, and the one worker that runs it lives only
 * as long as there is work for it. Both halves are about what a worker costs
 * in memory, which is the only thing that has ever constrained this.
 *
 * There is exactly one worker because a second one costs a 1.87 GB floor on
 * top of the first — the wasm module's fixed allocation, paid again per
 * worker — and inter-song parallelism was measured at 6.5 GB of live heap
 * that never subsides. (Not, as this comment once claimed, because "two jobs
 * would each get a share of the workers": there is no pool to share out, and
 * two workers really would use two cores.)
 *
 * And that worker is terminated and replaced when the queue drains, because
 * wasm memory never shrinks: after one 4-minute song it holds 3.08 GB, and
 * at the 7:00 Recording cap ~3.98 GB, for the tab's lifetime. See
 * recycleDrainedSlot().
 *
 * Every operation that reads-then-writes the catalogue (dispatching,
 * cancelling, retrying, reordering) runs through a single mutex so
 * two calls arriving close together — a job finishing while the user clicks
 * Cancel, two quick clicks on a reorder arrow — can't interleave their reads
 * and clobber each other's writes.
 */

import type { Separation, Song, SeparationFailureCause } from '../domain/types.ts';
import { getAllSeparations, getSeparation, putSeparation, deleteSeparation } from '../storage/db.ts';
import { deleteSeparationBytes, readRecording } from '../storage/opfs.ts';
import { orderedQueue, reorderQueue, nextQueueOrder } from './queue.ts';
import { isStalled } from './watchdog.ts';
import { decodeRecording } from './decode.ts';
import { exceedsLengthCap, tooLongMessage } from '../intake/length.ts';

// ─── Public event types ───────────────────────────────────────────────────────

/**
 * Everything the worker can post, as a closed union.
 *
 * Three of these come straight from the wasm module, not from worker.ts:
 * demucs.js's `sendProgressUpdate` posts PROGRESS_UPDATE or, under batch
 * mode, PROGRESS_UPDATE_BATCH; `callWriteWasmLog` posts WASM_LOG. All three
 * appear exactly once in `wasm/dist/demucs.js`, so the vocabulary is closed
 * and fully known. (`wasm/README.md`'s message table documents only
 * PROGRESS_UPDATE — knowingly left incomplete; this type is the record.)
 *
 * The handler below matches on this union and ignores anything else. The
 * inversion is the point: a message the engine does not recognise must be
 * inert by construction, never fall through to the path that ends a job.
 * Special-casing WASM_LOG alone would not do — PROGRESS_UPDATE_BATCH is a
 * second kind sitting behind worker.ts's hardcoded `batchMode: false`, and
 * a whitelist leaves that trap armed for whoever flips the flag.
 */
type WorkerMessage =
  | { kind: 'progress'; progress: number }
  | { kind: 'chatter' }
  | { kind: 'done'; song: Song }
  | { kind: 'failed'; error: string | null; cause: SeparationFailureCause; failedAt: number };

function classify(data: unknown): WorkerMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  switch (d.msg) {
    case 'PROGRESS_UPDATE':
      return { kind: 'progress', progress: typeof d.data === 'number' ? d.data : 0 };
    // Recognised so it can never be mistaken for a terminal message, but not
    // read as progress: worker.ts passes batchMode: false, so nothing can
    // produce one today and its payload's shape has never been observed.
    // Guessing it matches PROGRESS_UPDATE's 0..1 would put a fabricated
    // percentage in front of the user the day someone flips the flag —
    // exactly the kind of armed trap §2.1 exists to disarm. Whoever flips it
    // gives this branch a real meaning then.
    case 'PROGRESS_UPDATE_BATCH':
    case 'WASM_LOG':
      return { kind: 'chatter' };
  }

  if (d.type === 'done' && d.song) return { kind: 'done', song: d.song as Song };
  if (d.type === 'failed') {
    return {
      kind: 'failed',
      error: typeof d.error === 'string' ? d.error : null,
      cause: (d.cause as SeparationFailureCause | undefined) ?? 'worker',
      failedAt: typeof d.failedAt === 'number' ? d.failedAt : Date.now(),
    };
  }

  return null;
}

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
// Stated in the user's terms. "The worker was restarted" describes the slot
// being replaced — an internal bookkeeping step that is neither something the
// user did nor something they got.
const STALL_MESSAGE = 'The separation stopped responding and was given up on.';
const STALL_CHECK_INTERVAL_MS = 30 * 1000;

// ─── Internal state ───────────────────────────────────────────────────────────

interface Slot {
  worker: Worker;
  busy: boolean;
  job: Separation | null; // the Separation currently dispatched to this worker
  lastActivityAt: number; // last dispatch or worker message; watchdog basis
  lastEmittedPercent: number; // coalesces progress to what the UI can show
  hasRun: boolean; // has this worker ever been handed a job — i.e. holds a heap
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
 * Runs a Separation again from scratch, reusing its retained Recording, at
 * the back of the queue. Serves both surfaces that offer it — Retry on a
 * failed Separation, "Start over" on an interrupted one.
 *
 * This used to be two functions. `resume()` cleared the parked flag and
 * `retry()` cleared the failure fields, but both did the same thing —
 * nextQueueOrder, then dispatch — and neither could do anything else, since
 * there is no mid-inference resume to offer. Two entry points behind one
 * label is the state that produced a notice whose whole job was to take the
 * "Resume" label back; one operation that clears everything ends it.
 */
export async function retry(id: string): Promise<void> {
  await locked(async () => {
    const sep = await getSeparation(id);
    if (!sep || (sep.status !== 'failed' && !sep.interrupted)) return;

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
  const slot: Slot = {
    worker, busy: false, job: null, lastActivityAt: Date.now(),
    lastEmittedPercent: -1, hasRun: false,
  };

  worker.addEventListener('message', (evt: MessageEvent) => {
    // Ignore messages from a worker that has since been replaced (e.g. by
    // cancel()) — terminate() may not prevent an already in-flight message.
    if (current !== slot) return;

    const message = classify(evt.data);
    if (!message) return; // unrecognised: inert, by construction

    switch (message.kind) {
      // Deliberately does NOT touch lastActivityAt. The wasm posts ~1850 logs
      // per Separation at ~3.6/s, so counting them as proof of life would
      // hold the watchdog off for as long as the module keeps talking —
      // including through an inference that has stopped making progress. Only
      // progress is progress. See watchdog.ts, whose derivation depends on
      // this: the windows it tolerates are the silent head and tail.
      case 'chatter':
        return;

      case 'progress': {
        slot.lastActivityAt = Date.now();
        if (!slot.job) return;
        // ~3.6 progress messages a second, ~1800 over a Separation, against a
        // UI that renders whole percent. Emitting each one would drive a React
        // re-render per message for a value that changed in the fourth decimal
        // place — so only a change the user could see is published.
        const percent = Math.round(message.progress * 100);
        if (percent === slot.lastEmittedPercent) return;
        slot.lastEmittedPercent = percent;
        emit({ type: 'progress', id: slot.job.id, progress: message.progress });
        return;
      }

      case 'done': {
        const job = releaseJob(slot);
        if (job) emit({ type: 'done', id: job.id, song: message.song });
        dispatch();
        return;
      }

      case 'failed': {
        const job = releaseJob(slot);
        if (job) {
          const failed: Separation = {
            ...job,
            status: 'failed',
            error: message.error,
            cause: message.cause,
            failedAt: message.failedAt,
          };
          emit({ type: 'failed', separation: failed });
        }
        dispatch();
        return;
      }
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

// Hands the slot's job back and frees it for the next one. The single place
// `busy`/`job` are cleared on a normal outcome, so "the slot is free" and
// "the job is finished" can't drift apart.
function releaseJob(slot: Slot): Separation | null {
  const job = slot.job;
  slot.busy = false;
  slot.job = null;
  return job;
}

// Shared by the 'error' listener above and pollCurrentJob()'s stall check
// below: both found a worker that will never post 'done'/'failed' on its
// own, so both need the same recovery — drop the job, get a fresh worker
// in, report the failure, and let the queue move on to whatever's next.
function recoverDeadSlot(slot: Slot, cause: SeparationFailureCause, error: string): void {
  const job = slot.job;
  replaceSlot();
  if (!job) return;
  void reportFailure(job, cause, error);
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
    releaseJob(slot);
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

// Why 'busy' and 'drained' are distinct rather than one falsy "no job":
// the busy case is the ordinary one — addToQueue() calls dispatch() while a
// job is running — and it must leave that job strictly alone. Only a genuine
// drain is grounds for taking the worker away.
type ClaimResult =
  | { kind: 'claimed'; job: Separation }
  | { kind: 'busy' }
  | { kind: 'drained' };

function dispatch(): void {
  void locked(claimNext).then(result => {
    if (result.kind === 'claimed') void runJob(result.job);
  });
}

// Claims the next queued Separation for the current slot and commits its
// 'running' status, all under the catalogue mutex — the same lock cancel()
// uses to delete a Separation. Without that, the write here and a
// concurrent cancel() race as independent IDB transactions, and a
// cancelled job can be resurrected by whichever one lands last. Decoding
// (see runJob) runs after the lock is released, so it can't hold up
// cancel/reorder/retry for however long a large file takes to decode.
//
// Recycling the drained worker happens here, under the same lock, for the
// same reason: "the queue is empty" is a fact about the catalogue, and it
// must not go stale between the read and the terminate().
async function claimNext(): Promise<ClaimResult> {
  const slot = current;
  if (!slot || slot.busy) return { kind: 'busy' }; // one Separation runs at a time

  const all = await getAllSeparations();
  // The slot moved on while that read was in flight.
  if (current !== slot || slot.busy) return { kind: 'busy' };

  // orderedQueue excludes interrupted rows — correct here: an interrupted
  // Separation has no worker of its own to protect, and holds no heap.
  const next = orderedQueue(all)[0];
  if (!next) {
    recycleDrainedSlot(slot);
    return { kind: 'drained' };
  }

  const running: Separation = { ...next, status: 'running', progress: 0 };
  slot.busy = true;
  slot.hasRun = true;
  slot.job = running;
  slot.lastActivityAt = Date.now();
  slot.lastEmittedPercent = -1;

  await putSeparation(running);
  emit({ type: 'updated', separation: running });
  return { kind: 'claimed', job: running };
}

// A worker's wasm heap never subsides — 3.08 GB after one 4-minute song,
// ~3.98 GB at the 7:00 cap, held for the tab's lifetime with nothing to
// reclaim it. Terminating the drained worker is the only way to give that
// back, and it's the same move cancel() already makes.
//
// Terminate-and-replace, not drop-to-null, so `current` stays non-null and
// every identity guard in this file stays trivially correct. The
// replacement holds nothing: worker.ts's ensureReady() loads the module and
// the weights lazily, on the first run.
//
// The has-run gate makes the predicate exactly "this worker holds a heap" —
// without it, start()'s own dispatch() on an empty queue would terminate the
// worker it just created, on every load. The cost is 12 s of setup on the
// next job, ~2.3% of an 8:43 run, and only after an idle gap: a full queue
// never drains between jobs.
function recycleDrainedSlot(slot: Slot): void {
  if (!slot.hasRun) return;
  terminateSlot();
}

// Decodes the claimed job's Recording and dispatches it to the worker.
// OfflineAudioContext only exists on the main thread — unlike everything
// else the worker needs — so decoding happens here, not in worker.ts; see
// decode.ts. A decode failure is reported directly, without ever starting
// the worker.
async function runJob(job: Separation): Promise<void> {
  const slot = current;
  // Same guard the decode path below relies on: dispatch() resolves outside
  // the mutex, so a cancel() between the claim and here has already deleted
  // this Separation, and touching it now would resurrect wreckage.
  if (!slot || slot.job !== job) return;

  // The length cap again, this time before the worker is handed anything.
  // Intake (intake/length.ts) refuses over-length Recordings up front, so
  // this exists solely for rows queued before the cap landed: left alone
  // such a row would spend 9–15 minutes reaching the wasm's memory abort and
  // then report a generic RuntimeError rather than a length problem.
  //
  // Its own cause, not 'worker'. The failed row's advice is driven by the
  // cause alone — `error` is stored but never rendered — so reusing 'worker'
  // would tell the user to close some tabs and retry a song that can never
  // fit, no matter how many tabs they close.
  if (exceedsLengthCap(job.durationSec)) {
    releaseJob(slot);
    void reportFailure(job, 'toolong', tooLongMessage(job.durationSec));
    return;
  }

  try {
    const bytes = await readRecording(job.uploadPath);
    const recording = await decodeRecording(bytes);

    // The slot may have been cancelled or replaced while decode was in
    // flight — cancel() already deleted the Separation, so posting to a
    // terminated worker or reporting a failure for it now would resurrect
    // wreckage that's supposed to leave nothing behind.
    if (current !== slot || slot.job !== job) return;

    slot.worker.postMessage(
      { type: 'run', separation: job, ...recording },
      [recording.left.buffer, recording.right.buffer],
    );
  } catch (e) {
    if (current !== slot || slot.job !== job) return;

    slot.busy = false;
    slot.job = null;
    const message = e instanceof Error ? e.message : String(e);
    void reportFailure(job, 'decode', message);
  }
}

// Persists a failure for `job`, notifies listeners, and lets the queue move
// on — the shape shared by every path that gives up on a job outside the
// worker's own failure report (a dead worker, or a decode failure that
// never reached the worker at all).
async function reportFailure(job: Separation, cause: SeparationFailureCause, error: string): Promise<void> {
  const failed: Separation = { ...job, status: 'failed', error, cause, failedAt: Date.now() };
  await putSeparation(failed).catch(() => undefined);
  emit({ type: 'failed', separation: failed });
  dispatch();
}
