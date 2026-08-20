/**
 * The visible time window (§5.1, §5.2): a start offset and a span, both in
 * seconds. Zoom changes durationSec; pan and auto-follow change startSec.
 * Every mutator here clamps back into [0, songDurationSec] and
 * [minDurationSec, songDurationSec], so composing these can never produce an
 * out-of-range viewport — callers don't re-clamp afterward.
 */

import { PEAKS_SAMPLES_PER_PIXEL } from '../separation/peaks.ts';
import { clamp } from './clamp.ts';

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

// Two viewports are the same window iff both fields match. `Object.is`
// rather than `===` deliberately: it reports NaN as equal to NaN, so a
// degenerate viewport compares equal to itself instead of looking like a
// change on every call — which is what lets the callers below terminate.
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return Object.is(a.startSec, b.startSec) && Object.is(a.durationSec, b.durationSec);
}

// Returns the *same object* when clamping changes nothing, so a caller
// doing `setViewport(v => panViewport(v, …))` at the pan/zoom limit hands
// React an unchanged reference and the re-render is skipped entirely.
export function clampViewport(viewport: Viewport, songDurationSec: number, minDurationSec: number): Viewport {
  const songDuration = Math.max(0, songDurationSec);
  const maxDurationSec = Math.max(minDurationSec, songDuration);
  const durationSec = clamp(viewport.durationSec, minDurationSec, maxDurationSec);
  const maxStartSec = Math.max(0, songDuration - durationSec);
  const startSec = clamp(viewport.startSec, 0, maxStartSec);
  const next = { startSec, durationSec };
  return sameViewport(next, viewport) ? viewport : next;
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

/**
 * The whole auto-follow decision, as one pure function: the next viewport,
 * or `null` when there is nothing to do. `WaveformStage` applies this during
 * render, so its termination is this function's contract, not the caller's
 * discipline — **calling it again with the viewport it just returned must
 * yield `null`** (see the idempotency test), or the render loops until React
 * throws "Too many re-renders".
 *
 * Three ways there is nothing to do, and each is load-bearing:
 *
 *   1. The playhead is already visible — the common case (§5.2: follow never
 *      nudges a viewport the playhead is still inside).
 *   2. An input is non-finite. A NaN duration or sample rate poisons every
 *      comparison below (`NaN < x` and `NaN > x` are both false), so no
 *      viewport can ever contain the position. Refusing to follow leaves the
 *      viewport merely stale rather than hanging the route.
 *   3. Following wouldn't move the viewport. This is the case that actually
 *      bit (#87): during the first output-latency window after Play the
 *      playhead is legitimately *negative*, and `clampViewport` floors
 *      `startSec` at 0 — so the position is outside the viewport and no
 *      follow can bring it in. Comparing by value catches every such
 *      unreachable position without having to enumerate them.
 */
export function followIfNeeded(
  viewport: Viewport,
  positionSec: number,
  songDurationSec: number,
  minDurationSec: number,
): Viewport | null {
  if (!Number.isFinite(positionSec) || !Number.isFinite(songDurationSec) || !Number.isFinite(minDurationSec)) {
    return null;
  }
  if (isPositionVisible(positionSec, viewport)) return null;
  const next = followViewport(viewport, positionSec, songDurationSec, minDurationSec);
  return sameViewport(next, viewport) ? null : next;
}
