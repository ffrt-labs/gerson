/**
 * Pure queue-ordering logic for Separations. One Separation runs at a time;
 * these functions decide which one, in what order, and how reordering and
 * resuming affect that order — kept free of storage/engine side effects so
 * the policy is unit-testable on its own.
 */

import type { Separation } from '../domain/types.ts';

// A Separation that is either running or waiting its turn (including an
// interrupted one — still status 'queued' until an explicit Resume). Shared
// by anything that needs to know "is a job in flight", e.g. the job status
// bar and the PWA update gate (spec §8: reloading kills Workers).
export function isActive(s: Separation): boolean {
  return s.status === 'running' || s.status === 'queued';
}

// The dispatch order: queued Separations waiting their turn, excluding any
// that are interrupted (those wait for an explicit Resume) — ascending by
// queueOrder, so index 0 runs next.
export function orderedQueue(separations: Separation[]): Separation[] {
  return separations
    .filter(s => s.status === 'queued' && !s.interrupted)
    .sort((a, b) => a.queueOrder - b.queueOrder);
}

// 1-based position in the dispatch queue, or null if the Separation isn't
// waiting in it (running, failed, interrupted, or unknown).
export function queuePosition(separations: Separation[], id: string): number | null {
  const index = orderedQueue(separations).findIndex(s => s.id === id);
  return index === -1 ? null : index + 1;
}

// Moves a queued Separation up or down by swapping its queueOrder with the
// neighbouring job's. Returns the (two) records whose queueOrder changed,
// for the caller to persist — or null if there is nothing to swap (already
// at that end of the queue, or the id isn't an eligible queued job).
export function reorderQueue(
  separations: Separation[],
  id: string,
  direction: 'up' | 'down',
): Separation[] | null {
  const queue = orderedQueue(separations);
  const index = queue.findIndex(s => s.id === id);
  if (index === -1) return null;

  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= queue.length) return null;

  const current = queue[index];
  const neighbor = queue[neighborIndex];
  return [
    { ...current, queueOrder: neighbor.queueOrder },
    { ...neighbor, queueOrder: current.queueOrder },
  ];
}

// A queueOrder guaranteed to run after every existing one — used when a
// Separation is freshly enqueued, resumed, or retried, so it joins the back
// of the queue.
export function nextQueueOrder(separations: Separation[]): number {
  const maxExisting = separations.reduce((max, s) => Math.max(max, s.queueOrder), 0);
  return Math.max(Date.now(), maxExisting + 1);
}
