/**
 * Downsamples stored Int8 stereo peaks (§3.4: [Lmin, Lmax, Rmin, Rmax] per
 * source pixel, 256 samples/pixel) to exactly `targetColumns` display
 * columns. Aggregation is on the fly, off the single stored array: min-of-
 * mins, max-of-maxes across both the grouped source pixels and both
 * channels, so a display column never misses a transient that falls inside
 * its span.
 *
 * `range` restricts aggregation to a sub-span of the stored array, in
 * fractional source-column units — this is what lets zooming in stop at 1
 * stored pair per pixel (§5.1) instead of always spanning the whole song:
 * the range shrinks as the caller zooms in, until it's exactly targetColumns
 * wide and every display column is exactly one stored pair.
 */

import { PEAKS_SAMPLES_PER_PIXEL } from '../separation/peaks.ts';
import { clamp } from './clamp.ts';
import type { Viewport } from './viewport.ts';

export interface PeakColumn {
  readonly min: number; // Int8 range, -128..0
  readonly max: number; // Int8 range, 0..127
}

export interface SourceColumnRange {
  readonly start: number; // fractional source-column index, inclusive
  readonly end: number; // fractional source-column index, exclusive
}

export function aggregatePeaksToWidth(
  peaks: Int8Array,
  targetColumns: number,
  range: SourceColumnRange = { start: 0, end: peaks.length / 4 },
): PeakColumn[] {
  const sourceColumns = peaks.length / 4;
  if (targetColumns <= 0 || sourceColumns <= 0) return [];

  const rangeStart = clamp(range.start, 0, sourceColumns);
  const rangeEnd = clamp(range.end, rangeStart, sourceColumns);
  const span = rangeEnd - rangeStart;

  const columns: PeakColumn[] = new Array(targetColumns);
  for (let col = 0; col < targetColumns; col++) {
    if (span <= 0) {
      // The requested range sits entirely outside the stored data (e.g. a
      // viewport that's run off the end of a still-short peaks array) —
      // silence, not garbage from an empty or inverted bucket.
      columns[col] = { min: 0, max: 0 };
      continue;
    }

    // Proportional source range for this display column — never an empty
    // bucket, even on an uneven split: the end index is floored but always
    // pushed at least one past the start.
    const start = rangeStart + (col * span) / targetColumns;
    const end = rangeStart + ((col + 1) * span) / targetColumns;
    const srcStart = Math.floor(start);
    const srcEnd = Math.max(srcStart + 1, Math.floor(end));

    let min = 0;
    let max = 0;
    for (let src = srcStart; src < srcEnd && src < sourceColumns; src++) {
      const base = src * 4;
      const lMin = peaks[base];
      const lMax = peaks[base + 1];
      const rMin = peaks[base + 2];
      const rMax = peaks[base + 3];
      if (lMin < min) min = lMin;
      if (rMin < min) min = rMin;
      if (lMax > max) max = lMax;
      if (rMax > max) max = rMax;
    }
    columns[col] = { min, max };
  }
  return columns;
}

// Converts a Viewport (seconds) to a source-column range and aggregates —
// the entry point the waveform rows use, so they never touch source-column
// arithmetic directly.
export function aggregatePeaksForViewport(
  peaks: Int8Array,
  viewport: Viewport,
  targetColumns: number,
  sampleRate: number,
): PeakColumn[] {
  const columnsPerSecond = sampleRate / PEAKS_SAMPLES_PER_PIXEL;
  const start = viewport.startSec * columnsPerSecond;
  const end = (viewport.startSec + viewport.durationSec) * columnsPerSecond;
  return aggregatePeaksToWidth(peaks, targetColumns, { start, end });
}
