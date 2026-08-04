import { describe, it, expect } from 'vitest';
import { computePeaks, PEAKS_SAMPLES_PER_PIXEL } from '../peaks.js';

function silence(n: number): Float32Array {
  return new Float32Array(n);
}

function ramp(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = (i / (n - 1)) * 2 - 1; // -1 to +1
  return a;
}

describe('computePeaks', () => {
  it('returns 4 bytes per pixel', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL * 3;
    const peaks = computePeaks(silence(n), silence(n));
    expect(peaks.length).toBe(3 * 4);
  });

  it('rounds up to a full pixel for a partial last chunk', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL + 1; // 2 pixels
    const peaks = computePeaks(silence(n), silence(n));
    expect(peaks.length).toBe(2 * 4);
  });

  it('all-silence produces zeros', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL * 2;
    const peaks = computePeaks(silence(n), silence(n));
    expect(Array.from(peaks)).toEqual(new Array(8).fill(0));
  });

  it('min value is always ≤ max value per channel', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL * 4;
    const peaks = computePeaks(ramp(n), ramp(n));
    for (let px = 0; px < 4; px++) {
      const lMin = peaks[px * 4 + 0];
      const lMax = peaks[px * 4 + 1];
      const rMin = peaks[px * 4 + 2];
      const rMax = peaks[px * 4 + 3];
      expect(lMin).toBeLessThanOrEqual(lMax);
      expect(rMin).toBeLessThanOrEqual(rMax);
    }
  });

  it('values are in [-128, 127]', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL;
    // +1.0 → Int8 max (127); -1.0 → Int8 min (-127 after Math.round(-1 * 127))
    const full = new Float32Array(n).fill(1.0);
    const peaks = computePeaks(full, full);
    for (const v of peaks) {
      expect(v).toBeGreaterThanOrEqual(-128);
      expect(v).toBeLessThanOrEqual(127);
    }
  });

  it('a channel pinned at +1 produces lMin=0 lMax=127', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL;
    const pos = new Float32Array(n).fill(1.0);
    const peaks = computePeaks(pos, pos);
    expect(peaks[0]).toBe(0);   // lMin (no negative samples)
    expect(peaks[1]).toBe(127); // lMax
    expect(peaks[2]).toBe(0);   // rMin
    expect(peaks[3]).toBe(127); // rMax
  });

  it('a channel pinned at -1 produces lMin=-127 lMax=0', () => {
    const n = PEAKS_SAMPLES_PER_PIXEL;
    const neg = new Float32Array(n).fill(-1.0);
    const peaks = computePeaks(neg, neg);
    expect(peaks[0]).toBe(-127); // lMin
    expect(peaks[1]).toBe(0);    // lMax (no positive samples)
  });

  it('handles a single-sample input', () => {
    const l = new Float32Array([0.5]);
    const r = new Float32Array([-0.5]);
    const peaks = computePeaks(l, r);
    expect(peaks.length).toBe(4);
    expect(peaks[0]).toBe(0);    // lMin (0.5 is positive, so min stays 0)
    expect(peaks[1]).toBe(64);   // lMax = round(0.5 * 127) = round(63.5) = 64
    expect(peaks[2]).toBe(-63);  // rMin = round(-0.5 * 127) = round(-63.5) = -63 (JS rounds toward +∞)
    expect(peaks[3]).toBe(0);    // rMax
  });
});
