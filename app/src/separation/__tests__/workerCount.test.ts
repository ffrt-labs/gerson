import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeWorkerCount } from '../workerCount.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function withDeviceMemory(gb: number | undefined, fn: () => void) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { deviceMemory: gb },
    configurable: true,
    writable: true,
  });
  try { fn(); } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

describe('computeWorkerCount', () => {
  it('returns 1 when navigator.deviceMemory is not available', () => {
    withDeviceMemory(undefined, () => {
      expect(computeWorkerCount()).toBe(1);
    });
  });

  it('returns 1 for 4 GB RAM', () => {
    withDeviceMemory(4, () => {
      expect(computeWorkerCount()).toBe(1);
    });
  });

  it('returns 1 for 2 GB RAM (less than one full slot)', () => {
    withDeviceMemory(2, () => {
      expect(computeWorkerCount()).toBe(1);
    });
  });

  it('returns 2 for 8 GB RAM', () => {
    withDeviceMemory(8, () => {
      expect(computeWorkerCount()).toBe(2);
    });
  });

  it('returns 4 for 16 GB RAM', () => {
    withDeviceMemory(16, () => {
      expect(computeWorkerCount()).toBe(4);
    });
  });

  it('returns 8 for 32 GB RAM', () => {
    withDeviceMemory(32, () => {
      expect(computeWorkerCount()).toBe(8);
    });
  });

  it('returns 1 when deviceMemory is 0', () => {
    withDeviceMemory(0, () => {
      expect(computeWorkerCount()).toBe(1);
    });
  });
});
