/**
 * Draws the overlay canvas that spans the Stage waveform (§5.3): the
 * playhead and the loop focus, redrawn together every time either changes.
 * This is the 60fps path (the playhead moves every frame), and it never
 * touches a waveform bitmap.
 *
 * The three steps are separate exports rather than one call because paint
 * order is load-bearing and belongs to the caller: clear, then the loop
 * focus, then the playhead on top of it. (Folding the clear into
 * drawPlayhead, as this module used to, meant anything composited first was
 * wiped — which is why the clear now stands alone.)
 *
 * The region is drawn here read-only; it is only ever draggable from the
 * dedicated lane above the waveform (§5.4).
 */

import type { Canvas2DLike } from './canvas.ts';
import {
  WAVE_SOLO,
  LOOP_REGION_WASH,
  LOOP_REGION_WASH_OFF,
  OUTSIDE_LOOP_SCRIM,
} from './colors.ts';

export function clearOverlay(ctx: Canvas2DLike, widthPx: number, heightPx: number): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
}

/**
 * The playhead: a lime bar with a small triangular cap at the top, so its
 * position is readable at a glance even where it crosses a dense passage of
 * waveform. Both dimensions are passed in device pixels by the caller,
 * which is the only place that knows the devicePixelRatio.
 *
 * A playhead outside the viewport maps outside the canvas, and simply does
 * not draw — never pinned to an edge it is not at.
 */
export function drawPlayhead(
  ctx: Canvas2DLike,
  xPx: number,
  widthPx: number,
  heightPx: number,
  lineWidthPx: number,
  capHeightPx: number,
): void {
  if (heightPx <= 0) return;
  if (xPx < 0 || xPx > widthPx) return;

  ctx.fillStyle = WAVE_SOLO;
  ctx.fillRect(xPx - lineWidthPx / 2, 0, lineWidthPx, heightPx);

  ctx.beginPath();
  ctx.moveTo(xPx - capHeightPx, 0);
  ctx.lineTo(xPx + capHeightPx, 0);
  ctx.lineTo(xPx, capHeightPx);
  ctx.closePath();
  ctx.fill();
}

/**
 * The loop as the focus of the waveform ("both" shading from the handoff,
 * and the intended default): everything *outside* the region is scrimmed
 * back so the waveform there reads at about a third of its strength, and
 * the region itself takes an amber wash.
 *
 * When the loop is set but not repeating, the scrim is dropped entirely and
 * only a fainter wash remains — toggling off must not look like losing the
 * region, but it must also not keep dimming a Song that is playing right
 * through the region.
 */
export function drawLoopFocus(
  ctx: Canvas2DLike,
  startXPx: number,
  endXPx: number,
  widthPx: number,
  heightPx: number,
  enabled: boolean,
): void {
  if (heightPx <= 0) return;

  const left = Math.max(0, Math.min(startXPx, endXPx));
  const right = Math.min(widthPx, Math.max(startXPx, endXPx));
  if (right <= left) return;

  if (enabled) {
    ctx.fillStyle = OUTSIDE_LOOP_SCRIM;
    // A side the region runs off has nothing outside it to scrim.
    if (left > 0) ctx.fillRect(0, 0, left, heightPx);
    if (right < widthPx) ctx.fillRect(right, 0, widthPx - right, heightPx);
  }

  ctx.fillStyle = enabled ? LOOP_REGION_WASH : LOOP_REGION_WASH_OFF;
  ctx.fillRect(left, 0, right - left, heightPx);
}
