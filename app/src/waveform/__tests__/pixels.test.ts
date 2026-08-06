import { describe, it, expect } from 'vitest';
import { aggregatePeaksToWidth } from '../pixels.ts';

// Builds a stored peaks array from a list of [Lmin, Lmax, Rmin, Rmax] tuples,
// one per source pixel — the same shape computePeaks (separation/peaks.ts)
// produces.
function peaksOf(pixels: Array<[number, number, number, number]>): Int8Array {
  return Int8Array.from(pixels.flat());
}

describe('aggregatePeaksToWidth', () => {
  it('returns one column per source pixel when target equals source count', () => {
    const peaks = peaksOf([
      [-10, 20, -5, 15],
      [-40, 60, -20, 50],
    ]);
    expect(aggregatePeaksToWidth(peaks, 2)).toEqual([
      { min: -10, max: 20 },
      { min: -40, max: 60 },
    ]);
  });

  it('combines L and R into one envelope per column: min of mins, max of maxes', () => {
    const peaks = peaksOf([[-10, 20, -30, 5]]);
    expect(aggregatePeaksToWidth(peaks, 1)).toEqual([{ min: -30, max: 20 }]);
  });

  it('zooms out by grouping several source pixels into one column, min-of-mins/max-of-maxes', () => {
    const peaks = peaksOf([
      [-5, 5, -5, 5],
      [-100, 10, -10, 100], // the loudest transient anywhere in the group must survive
      [-1, 1, -1, 1],
      [-2, 90, -90, 2],
    ]);
    // 4 source pixels -> 1 display column covers the whole group.
    expect(aggregatePeaksToWidth(peaks, 1)).toEqual([{ min: -100, max: 100 }]);
  });

  it('never drops a source pixel: every bucket gets at least one, even with an uneven split', () => {
    // 5 source pixels into 2 columns: buckets of 2 and 3 by the proportional
    // split, not 2 and 2 with one silently dropped.
    const peaks = peaksOf([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [-77, 0, 0, 0], // must land in the second bucket's result
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const columns = aggregatePeaksToWidth(peaks, 2);
    expect(columns).toHaveLength(2);
    const overallMin = Math.min(...columns.map(c => c.min));
    expect(overallMin).toBe(-77);
  });

  it('produces exactly targetColumns columns regardless of source size', () => {
    const peaks = peaksOf(Array.from({ length: 41344 }, () => [-1, 1, -1, 1] as [number, number, number, number]));
    expect(aggregatePeaksToWidth(peaks, 1200)).toHaveLength(1200);
  });

  it('upsamples gracefully when target exceeds source (more display columns than stored pixels)', () => {
    const peaks = peaksOf([[-10, 10, -10, 10]]);
    const columns = aggregatePeaksToWidth(peaks, 3);
    expect(columns).toHaveLength(3);
    for (const column of columns) expect(column).toEqual({ min: -10, max: 10 });
  });

  it('returns an empty array for a non-positive target width', () => {
    const peaks = peaksOf([[-10, 10, -10, 10]]);
    expect(aggregatePeaksToWidth(peaks, 0)).toEqual([]);
    expect(aggregatePeaksToWidth(peaks, -5)).toEqual([]);
  });

  it('returns an empty array for empty peaks', () => {
    expect(aggregatePeaksToWidth(new Int8Array(0), 100)).toEqual([]);
  });
});
