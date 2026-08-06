/**
 * Draws the overlay canvas that spans all four stem rows (§5.3): the
 * playhead only, for now — a single line, redrawn every frame the position
 * moves. This is the 60fps path, and it never touches a waveform bitmap
 * (those four canvases redraw only on a click-to-seek gesture). Loop
 * shading is #29's addition, drawn into this same canvas alongside the line.
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
