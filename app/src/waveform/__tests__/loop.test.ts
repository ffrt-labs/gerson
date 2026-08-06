import { describe, it, expect } from 'vitest';
import {
  MIN_LOOP_LENGTH_SEC,
  hitTestLoopLane,
  dragToRegion,
  resizeStart,
  resizeEnd,
  moveRegion,
  clampRegionToDuration,
  setLength,
  setStartFromPlayhead,
  setEndFromPlayhead,
} from '../loop.ts';
import type { LoopRegion } from '../../domain/types.ts';

describe('hitTestLoopLane', () => {
  it('is always create with no existing region', () => {
    expect(hitTestLoopLane(5, null, 0.1)).toBe('create');
  });

  const region: LoopRegion = { startSec: 10, endSec: 20 };

  it('is resize-start within tolerance of the start edge', () => {
    expect(hitTestLoopLane(10, region, 0.5)).toBe('resize-start');
    expect(hitTestLoopLane(10.4, region, 0.5)).toBe('resize-start');
    expect(hitTestLoopLane(9.6, region, 0.5)).toBe('resize-start');
  });

  it('is resize-end within tolerance of the end edge', () => {
    expect(hitTestLoopLane(20, region, 0.5)).toBe('resize-end');
    expect(hitTestLoopLane(19.6, region, 0.5)).toBe('resize-end');
  });

  it('is move strictly inside the region, away from either edge', () => {
    expect(hitTestLoopLane(15, region, 0.5)).toBe('move');
  });

  it('is create outside the region entirely', () => {
    expect(hitTestLoopLane(5, region, 0.5)).toBe('create');
    expect(hitTestLoopLane(25, region, 0.5)).toBe('create');
  });
});

describe('dragToRegion', () => {
  it('spans low-to-high regardless of drag direction', () => {
    expect(dragToRegion(5, 15)).toEqual({ startSec: 5, endSec: 15 });
    expect(dragToRegion(15, 5)).toEqual({ startSec: 5, endSec: 15 });
  });
});

describe('resizeStart', () => {
  const region: LoopRegion = { startSec: 10, endSec: 20 };

  it('moves the start edge, leaving the end untouched', () => {
    expect(resizeStart(region, 12)).toEqual({ startSec: 12, endSec: 20 });
  });

  it('refuses to cross past endSec - MIN_LOOP_LENGTH_SEC', () => {
    const next = resizeStart(region, 19.99);
    expect(next.startSec).toBeCloseTo(20 - MIN_LOOP_LENGTH_SEC, 10);
    expect(next.endSec).toBe(20);
  });

  it('clamps at 0', () => {
    expect(resizeStart(region, -5)).toEqual({ startSec: 0, endSec: 20 });
  });
});

describe('resizeEnd', () => {
  const region: LoopRegion = { startSec: 10, endSec: 20 };

  it('moves the end edge, leaving the start untouched', () => {
    expect(resizeEnd(region, 25, 240)).toEqual({ startSec: 10, endSec: 25 });
  });

  it('refuses to cross before startSec + MIN_LOOP_LENGTH_SEC', () => {
    const next = resizeEnd(region, 10.01, 240);
    expect(next.startSec).toBe(10);
    expect(next.endSec).toBeCloseTo(10 + MIN_LOOP_LENGTH_SEC, 10);
  });

  it('clamps at the song duration', () => {
    expect(resizeEnd(region, 300, 240)).toEqual({ startSec: 10, endSec: 240 });
  });
});

describe('moveRegion', () => {
  const region: LoopRegion = { startSec: 10, endSec: 20 }; // length 10

  it('shifts both edges by deltaSec, preserving length exactly', () => {
    expect(moveRegion(region, 5, 240)).toEqual({ startSec: 15, endSec: 25 });
    expect(moveRegion(region, -5, 240)).toEqual({ startSec: 5, endSec: 15 });
  });

  it('clamps at the left edge of the song without shrinking the region', () => {
    const next = moveRegion(region, -100, 240);
    expect(next).toEqual({ startSec: 0, endSec: 10 });
  });

  it('clamps at the right edge of the song without shrinking the region', () => {
    const next = moveRegion(region, 300, 240);
    expect(next).toEqual({ startSec: 230, endSec: 240 });
  });
});

describe('clampRegionToDuration', () => {
  it('leaves an already-valid region untouched', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    expect(clampRegionToDuration(region, 240)).toEqual(region);
  });

  it('pulls both edges inside [0, durationSec]', () => {
    expect(clampRegionToDuration({ startSec: -5, endSec: 300 }, 240)).toEqual({ startSec: 0, endSec: 240 });
  });

  it('restores the minimum length when clamping collapses the region', () => {
    // Both edges clamp to the same point (durationSec) — must not leave a
    // zero-length region.
    const next = clampRegionToDuration({ startSec: 245, endSec: 250 }, 240);
    expect(next.endSec - next.startSec).toBeCloseTo(MIN_LOOP_LENGTH_SEC, 10);
    expect(next.endSec).toBe(240);
  });
});

describe('setLength', () => {
  it('resizes the end edge to startSec + lengthSec, start held fixed', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    expect(setLength(region, 15, 240)).toEqual({ startSec: 10, endSec: 25 });
  });

  it('clamps at the song duration', () => {
    const region: LoopRegion = { startSec: 230, endSec: 235 };
    expect(setLength(region, 100, 240)).toEqual({ startSec: 230, endSec: 240 });
  });
});

describe('setStartFromPlayhead', () => {
  it('with no region, seeds one from the playhead to the song end', () => {
    expect(setStartFromPlayhead(null, 30, 240)).toEqual({ startSec: 30, endSec: 240 });
  });

  it('with a region, moves the start edge to the playhead', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    expect(setStartFromPlayhead(region, 12, 240)).toEqual({ startSec: 12, endSec: 20 });
  });

  it('clamps rather than crossing the end edge when the playhead is past it', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    const next = setStartFromPlayhead(region, 25, 240);
    expect(next.startSec).toBeCloseTo(20 - MIN_LOOP_LENGTH_SEC, 10);
  });
});

describe('setEndFromPlayhead', () => {
  it('with no region, seeds one from the song start to the playhead', () => {
    expect(setEndFromPlayhead(null, 30, 240)).toEqual({ startSec: 0, endSec: 30 });
  });

  it('with a region, moves the end edge to the playhead', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    expect(setEndFromPlayhead(region, 18, 240)).toEqual({ startSec: 10, endSec: 18 });
  });

  it('clamps rather than crossing the start edge when the playhead is before it', () => {
    const region: LoopRegion = { startSec: 10, endSec: 20 };
    const next = setEndFromPlayhead(region, 5, 240);
    expect(next.endSec).toBeCloseTo(10 + MIN_LOOP_LENGTH_SEC, 10);
  });
});
