import { describe, it, expect } from 'vitest';
import { orderedQueue, queuePosition, reorderQueue, nextQueueOrder } from '../queue.ts';
import type { Separation } from '../../domain/types.ts';

function makeSeparation(overrides: Partial<Separation> & { id: string }): Separation {
  return {
    title: overrides.id,
    durationSec: 180,
    status: 'queued',
    uploadPath: `recordings/${overrides.id}`,
    progress: 0,
    error: null,
    cause: null,
    failedAt: null,
    startedAt: 1000,
    interrupted: false,
    queueOrder: 1000,
    ...overrides,
  };
}

describe('orderedQueue', () => {
  it('returns only queued, non-interrupted separations sorted by queueOrder', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 3 });
    const b = makeSeparation({ id: 'b', queueOrder: 1 });
    const c = makeSeparation({ id: 'c', queueOrder: 2 });
    const running = makeSeparation({ id: 'running', status: 'running', queueOrder: 0 });
    const failed = makeSeparation({ id: 'failed', status: 'failed', queueOrder: 0 });
    const interrupted = makeSeparation({ id: 'interrupted', interrupted: true, queueOrder: 0 });

    const result = orderedQueue([a, b, c, running, failed, interrupted]);

    expect(result.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('queuePosition', () => {
  it('returns the 1-based position among queued, non-interrupted separations', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const b = makeSeparation({ id: 'b', queueOrder: 2 });
    const c = makeSeparation({ id: 'c', queueOrder: 3 });

    expect(queuePosition([a, b, c], 'a')).toBe(1);
    expect(queuePosition([a, b, c], 'b')).toBe(2);
    expect(queuePosition([a, b, c], 'c')).toBe(3);
  });

  it('returns null for a separation that is running, failed, interrupted, or unknown', () => {
    const running = makeSeparation({ id: 'running', status: 'running' });
    const failed = makeSeparation({ id: 'failed', status: 'failed' });
    const interrupted = makeSeparation({ id: 'interrupted', interrupted: true });

    const all = [running, failed, interrupted];
    expect(queuePosition(all, 'running')).toBeNull();
    expect(queuePosition(all, 'failed')).toBeNull();
    expect(queuePosition(all, 'interrupted')).toBeNull();
    expect(queuePosition(all, 'missing')).toBeNull();
  });
});

describe('reorderQueue', () => {
  it('moving a job up swaps queueOrder with its predecessor', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const b = makeSeparation({ id: 'b', queueOrder: 2 });
    const c = makeSeparation({ id: 'c', queueOrder: 3 });

    const changed = reorderQueue([a, b, c], 'b', 'up');

    expect(changed).not.toBeNull();
    const byId = Object.fromEntries(changed!.map(s => [s.id, s.queueOrder]));
    expect(byId).toEqual({ a: 2, b: 1 });

    // Re-deriving order from the patch reflects the new position.
    const patched = [a, b, c].map(s => changed!.find(c2 => c2.id === s.id) ?? s);
    expect(orderedQueue(patched).map(s => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('moving a job down swaps queueOrder with its successor', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const b = makeSeparation({ id: 'b', queueOrder: 2 });
    const c = makeSeparation({ id: 'c', queueOrder: 3 });

    const changed = reorderQueue([a, b, c], 'b', 'down');

    const byId = Object.fromEntries(changed!.map(s => [s.id, s.queueOrder]));
    expect(byId).toEqual({ b: 3, c: 2 });
  });

  it('returns null when already at the front and moving up', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const b = makeSeparation({ id: 'b', queueOrder: 2 });
    expect(reorderQueue([a, b], 'a', 'up')).toBeNull();
  });

  it('returns null when already at the back and moving down', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const b = makeSeparation({ id: 'b', queueOrder: 2 });
    expect(reorderQueue([a, b], 'b', 'down')).toBeNull();
  });

  it('returns null for a separation not in the queue', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    const running = makeSeparation({ id: 'running', status: 'running' });
    expect(reorderQueue([a, running], 'running', 'up')).toBeNull();
    expect(reorderQueue([a, running], 'missing', 'up')).toBeNull();
  });

  it('single-item queue cannot move in either direction', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 1 });
    expect(reorderQueue([a], 'a', 'up')).toBeNull();
    expect(reorderQueue([a], 'a', 'down')).toBeNull();
  });
});

describe('nextQueueOrder', () => {
  it('is greater than every existing queueOrder', () => {
    const a = makeSeparation({ id: 'a', queueOrder: 5 });
    const b = makeSeparation({ id: 'b', queueOrder: 12 });
    expect(nextQueueOrder([a, b])).toBeGreaterThan(12);
  });

  it('returns a positive number for an empty list', () => {
    expect(nextQueueOrder([])).toBeGreaterThan(0);
  });

  it('is strictly increasing across successive calls even within the same millisecond', () => {
    const a = makeSeparation({ id: 'a', queueOrder: Date.now() });
    const next = nextQueueOrder([a]);
    expect(next).toBeGreaterThan(a.queueOrder);
  });
});
