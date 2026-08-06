/**
 * Downsamples stored Int8 stereo peaks (§3.4: [Lmin, Lmax, Rmin, Rmax] per
 * source pixel, 256 samples/pixel) to exactly `targetColumns` display
 * columns — the fit-the-song viewport this ticket holds (#28 adds zoom).
 * Aggregation is on the fly, off the single stored array: min-of-mins,
 * max-of-maxes across both the grouped source pixels and both channels, so
 * a display column never misses a transient that falls inside its span.
 */

export interface PeakColumn {
  readonly min: number; // Int8 range, -128..0
  readonly max: number; // Int8 range, 0..127
}

export function aggregatePeaksToWidth(peaks: Int8Array, targetColumns: number): PeakColumn[] {
  const sourceColumns = peaks.length / 4;
  if (targetColumns <= 0 || sourceColumns <= 0) return [];

  const columns: PeakColumn[] = new Array(targetColumns);
  for (let col = 0; col < targetColumns; col++) {
    // Proportional source range for this display column — the same
    // never-empty-bucket rule as the zoomed-out path #28 will reuse.
    const start = Math.floor((col * sourceColumns) / targetColumns);
    const end = Math.max(start + 1, Math.floor(((col + 1) * sourceColumns) / targetColumns));

    let min = 0;
    let max = 0;
    for (let src = start; src < end && src < sourceColumns; src++) {
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
