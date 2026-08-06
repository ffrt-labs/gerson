/**
 * Draws one stem row from its aggregated peak columns: one path of vertical
 * segments, one moveTo/lineTo pair per column, a single stroke() call
 * (§5.3: "one path of ~1200 vertical segments — low single-digit ms").
 * Runs entirely in device-pixel space — callers size the canvas backing
 * store to devicePixelRatio and never call ctx.scale, so a column index
 * lines up 1:1 with a physical pixel column.
 */

import type { Canvas2DLike } from './canvas.ts';
import type { PeakColumn } from './pixels.ts';

const INT8_MAX = 127;

export function drawWaveform(
  ctx: Canvas2DLike,
  columns: readonly PeakColumn[],
  widthPx: number,
  heightPx: number,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  if (columns.length === 0 || heightPx <= 0) return;

  const centerY = heightPx / 2;
  const halfHeight = heightPx / 2;

  ctx.beginPath();
  for (let x = 0; x < columns.length; x++) {
    const { min, max } = columns[x];
    // Canvas y grows downward, so the louder (positive) sample draws above center.
    const yTop = centerY - (max / INT8_MAX) * halfHeight;
    const yBottom = centerY - (min / INT8_MAX) * halfHeight;
    ctx.moveTo(x + 0.5, yTop);
    ctx.lineTo(x + 0.5, yBottom);
  }
  ctx.stroke();
}
