/**
 * How long a Separation will take, in wall clock.
 *
 *   seconds = 12 (model setup) + 2.12 × durationSec (inference) + 2.4 (FLAC tail)
 *
 * Every term is measured, not guessed: ~12 s to load the module and weights,
 * 2.12x realtime inference (233 s of audio at 506.75 s wall clock), and ~2.4 s
 * to encode four Stems once the FLAC encoder is the real wasm build. Fed the
 * measured run's own input it predicts 508 s against 506.75 s actual.
 *
 * This matters more than a badge usually does. The estimate it replaced was
 * 1.28x — understating every wait by ~70% — and under a background job an
 * ETA that runs out three quarters of the way through teaches the user to
 * read a perfectly healthy run as a hang. That is this build's own symptom,
 * manufactured by its own copy.
 */

const SETUP_SEC = 12;
const REALTIME_FACTOR = 2.12;
const FLAC_TAIL_SEC = 2.4;

export function estimateSeconds(durationSec: number): number {
  return SETUP_SEC + REALTIME_FACTOR * durationSec + FLAC_TAIL_SEC;
}

export function estimateMinutes(durationSec: number): number {
  return Math.max(1, Math.round(estimateSeconds(durationSec) / 60));
}
