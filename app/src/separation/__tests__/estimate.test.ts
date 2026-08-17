import { describe, it, expect } from 'vitest';
import { estimateSeconds, estimateMinutes } from '../estimate.ts';

describe('estimateSeconds', () => {
  // The formula back-predicts the one fully-measured run — 233 s of audio at
  // 506.75 s wall clock — to within a couple of seconds.
  it('reproduces the measured run', () => {
    expect(estimateSeconds(233)).toBeCloseTo(508.36, 1);
  });

  it('charges the fixed setup and FLAC tail even for a very short Recording', () => {
    expect(estimateSeconds(0)).toBeCloseTo(14.4, 1);
  });

  it('is superlinear in nothing — the variable cost is a flat 2.12x realtime', () => {
    expect(estimateSeconds(240) - estimateSeconds(180)).toBeCloseTo(2.12 * 60, 5);
  });
});

describe('estimateMinutes', () => {
  it('reads ~9 minutes for a 4-minute song, not the old ~5', () => {
    expect(estimateMinutes(4 * 60)).toBe(9);
  });

  it('reads ~15 minutes at the 7:00 cap', () => {
    expect(estimateMinutes(7 * 60)).toBe(15);
  });

  it('never promises less than a minute', () => {
    expect(estimateMinutes(1)).toBe(1);
  });
});
