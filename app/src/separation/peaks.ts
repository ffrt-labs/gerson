export const PEAKS_SAMPLES_PER_PIXEL = 256;

/**
 * Compute waveform peaks from stereo PCM in a single pass.
 *
 * Returns an Int8Array of [L_min, L_max, R_min, R_max] per pixel,
 * where each pixel covers PEAKS_SAMPLES_PER_PIXEL samples.
 */
export function computePeaks(left: Float32Array, right: Float32Array): Int8Array {
  const numPixels = Math.ceil(left.length / PEAKS_SAMPLES_PER_PIXEL);
  const out = new Int8Array(numPixels * 4);

  for (let px = 0; px < numPixels; px++) {
    const start = px * PEAKS_SAMPLES_PER_PIXEL;
    const end = Math.min(start + PEAKS_SAMPLES_PER_PIXEL, left.length);

    let lMin = 0, lMax = 0, rMin = 0, rMax = 0;

    for (let i = start; i < end; i++) {
      if (left[i] < lMin) lMin = left[i];
      else if (left[i] > lMax) lMax = left[i];
      if (right[i] < rMin) rMin = right[i];
      else if (right[i] > rMax) rMax = right[i];
    }

    out[px * 4 + 0] = clampInt8(Math.round(lMin * 127));
    out[px * 4 + 1] = clampInt8(Math.round(lMax * 127));
    out[px * 4 + 2] = clampInt8(Math.round(rMin * 127));
    out[px * 4 + 3] = clampInt8(Math.round(rMax * 127));
  }

  return out;
}

function clampInt8(v: number): number {
  return v < -128 ? -128 : v > 127 ? 127 : v;
}
