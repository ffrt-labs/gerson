/**
 * The visible time window (§5.1, §5.2): a start offset and a span, both in
 * seconds. Zoom changes durationSec; pan and auto-follow change startSec.
 * Every mutator here clamps back into [0, songDurationSec] and
 * [minDurationSec, songDurationSec], so composing these can never produce an
 * out-of-range viewport — callers don't re-clamp afterward.
 */

import { PEAKS_SAMPLES_PER_PIXEL } from '../separation/peaks.ts';

export interface Viewport {
  readonly startSec: number;
  readonly durationSec: number;
}

// The zoomed-in floor (§5.1): one stored peaks pair per physical pixel —
// zooming in further would just be blowing up pixels the stored resolution
// doesn't have. 256 samples/pair at 44100 Hz = 5.8ms/px.
export function minVisibleDurationSec(widthPx: number, sampleRate: number): number {
  if (widthPx <= 0 || sampleRate <= 0) return 0;
  return (widthPx * PEAKS_SAMPLES_PER_PIXEL) / sampleRate;
}

export function fitTheSongViewport(songDurationSec: number): Viewport {
  return { startSec: 0, durationSec: Math.max(0, songDurationSec) };
}

export function clampViewport(viewport: Viewport, songDurationSec: number, minDurationSec: number): Viewport {
  const songDuration = Math.max(0, songDurationSec);
  const maxDurationSec = Math.max(minDurationSec, songDuration);
  const durationSec = clamp(viewport.durationSec, minDurationSec, maxDurationSec);
  const maxStartSec = Math.max(0, songDuration - durationSec);
  const startSec = clamp(viewport.startSec, 0, maxStartSec);
  return { startSec, durationSec };
}

// Zooms around focusSec, keeping it at the same fractional position within
// the viewport, so the point under the pointer doesn't drift while zooming.
// factor > 1 zooms in (smaller span); 0 < factor < 1 zooms out.
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  focusSec: number,
  songDurationSec: number,
  minDurationSec: number,
): Viewport {
  if (!(factor > 0)) return viewport;
  const rawDurationSec = viewport.durationSec / factor;
  const focusFraction = viewport.durationSec > 0 ? (focusSec - viewport.startSec) / viewport.durationSec : 0.5;
  const rawStartSec = focusSec - focusFraction * rawDurationSec;
  return clampViewport({ startSec: rawStartSec, durationSec: rawDurationSec }, songDurationSec, minDurationSec);
}

export function panViewport(
  viewport: Viewport,
  deltaSec: number,
  songDurationSec: number,
  minDurationSec: number,
): Viewport {
  return clampViewport(
    { startSec: viewport.startSec + deltaSec, durationSec: viewport.durationSec },
    songDurationSec,
    minDurationSec,
  );
}

export function isPositionVisible(positionSec: number, viewport: Viewport): boolean {
  return positionSec >= viewport.startSec && positionSec <= viewport.startSec + viewport.durationSec;
}

// The jump auto-follow makes when the playhead exits (§5.2): the viewport
// re-anchors so the playhead sits at its start edge, then holds still again
// until the next exit — it does not chase every frame.
export function followViewport(
  viewport: Viewport,
  positionSec: number,
  songDurationSec: number,
  minDurationSec: number,
): Viewport {
  return clampViewport({ startSec: positionSec, durationSec: viewport.durationSec }, songDurationSec, minDurationSec);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
