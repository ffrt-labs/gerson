/**
 * The x-position <-> seconds mapping for the fit-the-song viewport (§5.2:
 * "the viewport holds still"). Both directions are pure ratios against the
 * Song's total duration and the viewport's pixel width — never against
 * tempo, which only changes how fast the playhead sweeps across this fixed
 * mapping, not the mapping itself. That's what keeps click-to-seek and the
 * playhead accurate "at any tempo" (issue #27's acceptance criterion).
 */

export function secondsAtX(xPx: number, durationSec: number, widthPx: number): number {
  if (widthPx <= 0 || durationSec <= 0) return 0;
  const fraction = clamp01(xPx / widthPx);
  return fraction * durationSec;
}

export function playheadX(positionSec: number, durationSec: number, widthPx: number): number {
  if (durationSec <= 0) return 0;
  const fraction = clamp01(positionSec / durationSec);
  return fraction * widthPx;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
