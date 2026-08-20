/**
 * Combines the four Stems' stored peaks into one full-mix peaks array — the
 * data behind the Stage's single tall waveform (handoff "Waveform
 * rendering": one canvas showing the full mix, replacing the four stacked
 * rows).
 *
 * Deliberately not a sum: peaks are already min/max envelopes, so summing
 * them would clip almost everywhere and stop resembling the mix. The
 * envelope of the sum is bounded by, and visually indistinguishable from,
 * the extreme of the four envelopes at this resolution — and the extreme
 * cannot overflow Int8, which a sum of four ±127 columns would.
 *
 * The Recording itself is kept in full and would be the exact source, but
 * it has no stored peaks (only Stems do, §3.4), and decoding it on open
 * would cost seconds — this is the same shape of data, already on disk.
 */

import { ROLES, type Role } from '../domain/types.ts';

export function mixPeaks(peaks: Record<Role, Int8Array>): Int8Array {
  let length = 0;
  for (const role of ROLES) {
    if (peaks[role].length > length) length = peaks[role].length;
  }

  // A stem shorter than the longest simply stops contributing past its end,
  // leaving the zeros already in `out` — silence, not a truncated mix.
  const out = new Int8Array(length);
  for (const role of ROLES) {
    const stem = peaks[role];
    for (let i = 0; i < stem.length; i++) {
      // Even slots are minima (Lmin, Rmin), odd are maxima (Lmax, Rmax).
      if (i % 2 === 0) {
        if (stem[i] < out[i]) out[i] = stem[i];
      } else if (stem[i] > out[i]) {
        out[i] = stem[i];
      }
    }
  }
  return out;
}
