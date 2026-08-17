import { describe, it, expect } from 'vitest';
import { hasActiveSeparation } from '../updateGate.ts';
import { isActive } from '../../separation/queue.ts';
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

describe('hasActiveSeparation', () => {
  it('is false with no separations', () => {
    expect(hasActiveSeparation([])).toBe(false);
  });

  it('is true when a separation is running', () => {
    const sep = makeSeparation({ id: 'a', status: 'running' });
    expect(hasActiveSeparation([sep])).toBe(true);
  });

  it('is true when a separation is queued', () => {
    const sep = makeSeparation({ id: 'a', status: 'queued' });
    expect(hasActiveSeparation([sep])).toBe(true);
  });

  // The gate asks "would reloading destroy work?" — not "is there a row the
  // user should see", which is isActive's question and JobStatusBar's.
  it('is false for an interrupted separation, which has no worker to protect', () => {
    const sep = makeSeparation({ id: 'a', status: 'queued', interrupted: true });
    expect(hasActiveSeparation([sep])).toBe(false);
  });

  it('leaves isActive alone — an interrupted row is still active for the status bar', () => {
    const sep = makeSeparation({ id: 'a', status: 'queued', interrupted: true });
    expect(isActive(sep)).toBe(true);
  });

  it('still blocks when a genuinely queued separation sits behind an interrupted one', () => {
    const parked = makeSeparation({ id: 'a', status: 'queued', interrupted: true });
    const waiting = makeSeparation({ id: 'b', status: 'queued' });
    expect(hasActiveSeparation([parked, waiting])).toBe(true);
  });

  it('is false when every separation has failed', () => {
    const sep = makeSeparation({ id: 'a', status: 'failed' });
    expect(hasActiveSeparation([sep])).toBe(false);
  });

  it('is true when at least one of several separations is active', () => {
    const failed = makeSeparation({ id: 'a', status: 'failed' });
    const running = makeSeparation({ id: 'b', status: 'running' });
    expect(hasActiveSeparation([failed, running])).toBe(true);
  });
});
