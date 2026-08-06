/**
 * The x-position <-> seconds mapping for the current viewport (§5.1, §5.2):
 * both directions are pure ratios against the viewport's span and the
 * canvas's pixel width — never against tempo, which only changes how fast
 * the playhead sweeps across this mapping, not the mapping itself. That's
 * what keeps click-to-seek and the playhead accurate at any zoom level or
 * scroll offset (issue #28's acceptance criterion).
 */

import type { Viewport } from './viewport.ts';

export function secondsAtX(xPx: number, viewport: Viewport, widthPx: number): number {
  if (widthPx <= 0 || viewport.durationSec <= 0) return viewport.startSec;
  const fraction = clamp01(xPx / widthPx);
  return viewport.startSec + fraction * viewport.durationSec;
}

// Deliberately not clamped to [0, widthPx]: a playhead outside the current
// viewport must map outside the canvas too, so the overlay can simply let it
// draw off-screen (invisible) rather than pinning it to an edge it isn't at.
export function playheadX(positionSec: number, viewport: Viewport, widthPx: number): number {
  if (viewport.durationSec <= 0) return 0;
  const fraction = (positionSec - viewport.startSec) / viewport.durationSec;
  return fraction * widthPx;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
