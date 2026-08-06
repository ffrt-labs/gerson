/**
 * Draws the overlay canvas that spans all four stem rows (§5.3): the
 * playhead line and the loop-region shading, redrawn together every time
 * either changes. This is the 60fps path (the playhead moves every frame),
 * and it never touches a waveform bitmap (those four canvases redraw only
 * on a click-to-seek gesture or a track-state change). The region itself is
 * only ever draggable from the dedicated lane (LoopLane) — this canvas just
 * shows it "shaded down through all four waveforms" (§5.4).
 */

import type { Canvas2DLike } from './canvas.ts';

export function drawPlayhead(ctx: Canvas2DLike, xPx: number, widthPx: number, heightPx: number): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  if (heightPx <= 0) return;

  ctx.beginPath();
  ctx.moveTo(xPx + 0.5, 0);
  ctx.lineTo(xPx + 0.5, heightPx);
  ctx.stroke();
}

// Fills the loop region across the overlay's full height, clipped to the
// canvas — a region that runs off either edge of the current viewport
// (common while zoomed in) draws only its visible slice rather than
// distorting or wrapping. Dimmer when the loop is toggled off, so the
// region reads as "still set, not currently repeating" (§5.4: toggling off
// must not look like losing it). Composited after drawPlayhead, which owns
// the canvas clear — this call never clears on its own.
export function drawLoopShading(
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

  ctx.fillStyle = enabled ? 'rgba(217, 164, 65, 0.22)' : 'rgba(217, 164, 65, 0.10)';
  ctx.fillRect(left, 0, right - left, heightPx);
}
