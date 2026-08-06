import { describe, it, expect } from 'vitest';
import { aggregatePeaksToWidth, aggregatePeaksForViewport } from '../pixels.ts';
import { PEAKS_SAMPLES_PER_PIXEL } from '../../separation/peaks.ts';
import type { Viewport } from '../viewport.ts';

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

  it('restricts aggregation to a given source-column range (the zoomed-in path)', () => {
    const peaks = peaksOf([
      [-1, 1, -1, 1],
      [-99, 99, -99, 99], // outside the range: must not leak in
      [-5, 5, -5, 5],
      [-6, 6, -6, 6],
    ]);
    // Range [2, 4) covers exactly source pixels 2 and 3.
    expect(aggregatePeaksToWidth(peaks, 2, { start: 2, end: 4 })).toEqual([
      { min: -5, max: 5 },
      { min: -6, max: 6 },
    ]);
  });

  it('honours a fractional range boundary the same way as the whole-array proportional split', () => {
    const peaks = peaksOf([
      [-10, 10, -10, 10],
      [-20, 20, -20, 20],
      [-30, 30, -30, 30],
    ]);
    // Range [0.5, 2.5): srcStart = floor(0.5) = 0, srcEnd = floor(2.5) = 2 -> pixels 0,1 (half-open).
    expect(aggregatePeaksToWidth(peaks, 1, { start: 0.5, end: 2.5 })).toEqual([{ min: -20, max: 20 }]);
  });

  it('clamps a range that overshoots the stored array to the available data', () => {
    const peaks = peaksOf([[-10, 10, -10, 10]]);
    expect(aggregatePeaksToWidth(peaks, 1, { start: 0, end: 1000 })).toEqual([{ min: -10, max: 10 }]);
  });

  it('returns silent columns for a range entirely past the end of the stored array', () => {
    const peaks = peaksOf([[-10, 10, -10, 10]]);
    const columns = aggregatePeaksToWidth(peaks, 3, { start: 5, end: 8 });
    expect(columns).toEqual([{ min: 0, max: 0 }, { min: 0, max: 0 }, { min: 0, max: 0 }]);
  });
});

describe('aggregatePeaksForViewport', () => {
  const sampleRate = 44100;
  // 10 source pixels = 10 * 256 / 44100 seconds of stored audio.
  const sourcePixels: Array<[number, number, number, number]> = Array.from({ length: 10 }, (_, i) => [
    -i - 1, i + 1, -i - 1, i + 1,
  ]);
  const peaks = peaksOf(sourcePixels);
  const totalSec = (sourcePixels.length * PEAKS_SAMPLES_PER_PIXEL) / sampleRate;

  it('at the 1-pair/px floor (viewport width == targetColumns in source columns), each column is exactly one stored pixel', () => {
    const viewport: Viewport = { startSec: 0, durationSec: totalSec };
    const columns = aggregatePeaksForViewport(peaks, viewport, 10, sampleRate);
    expect(columns).toEqual(sourcePixels.map(([, max]) => ({ min: -max, max })));
  });

  it('a viewport over half the song aggregates only that half', () => {
    const halfSec = totalSec / 2;
    const viewport: Viewport = { startSec: halfSec, durationSec: halfSec };
    const columns = aggregatePeaksForViewport(peaks, viewport, 5, sampleRate);
    // Second half is source pixels 5..9 -> mins/maxes -6..6 through -10..10.
    expect(columns).toEqual([
      { min: -6, max: 6 },
      { min: -7, max: 7 },
      { min: -8, max: 8 },
      { min: -9, max: 9 },
      { min: -10, max: 10 },
    ]);
  });

  it('zooming out to fit-the-song (viewport spans the whole duration) matches the whole-array aggregation', () => {
    const viewport: Viewport = { startSec: 0, durationSec: totalSec };
    expect(aggregatePeaksForViewport(peaks, viewport, 2, sampleRate)).toEqual(aggregatePeaksToWidth(peaks, 2));
  });
});
