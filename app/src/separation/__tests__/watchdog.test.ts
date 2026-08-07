import { describe, it, expect } from 'vitest';
import { isStalled, STALL_TIMEOUT_MS } from '../watchdog.ts';

describe('isStalled', () => {
  it('is false when the gap since the last activity is under the timeout', () => {
    expect(isStalled(0, STALL_TIMEOUT_MS - 1)).toBe(false);
  });

  it('is true once the gap exceeds the timeout', () => {
    expect(isStalled(0, STALL_TIMEOUT_MS + 1)).toBe(true);
  });

  it('is false exactly at the timeout boundary', () => {
    expect(isStalled(0, STALL_TIMEOUT_MS)).toBe(false);
  });

  it('respects a custom timeout override', () => {
    expect(isStalled(0, 100, 50)).toBe(true);
    expect(isStalled(0, 40, 50)).toBe(false);
  });
});
