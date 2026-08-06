/**
 * The mid-gesture fast path (§5.3): instead of recomputing columns from
 * peaks on every pan/zoom tick, blit whatever is already on the canvas —
 * scaled and translated from the viewport it currently shows to the new
 * one, one `drawImage` per row. Slightly soft while the pointer moves,
 * which nobody notices mid-gesture; the sharp re-render happens once, on
 * gesture end, back in the row's own draw effect. Self-blitting a canvas
 * onto itself is well-defined by spec (the source is snapshotted before the
 * destination is overwritten), so no separate offscreen bitmap is kept —
 * nothing here allocates anything the size of the full song.
 */

import type { Viewport } from './viewport.ts';

export interface Canvas2DBlitLike {
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export function blitViewportShift(
  ctx: Canvas2DBlitLike,
  source: CanvasImageSource,
  fromViewport: Viewport,
  toViewport: Viewport,
  widthPx: number,
  heightPx: number,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  if (fromViewport.durationSec <= 0 || toViewport.durationSec <= 0 || widthPx <= 0 || heightPx <= 0) return;

  const scale = fromViewport.durationSec / toViewport.durationSec;
  const sx = ((toViewport.startSec - fromViewport.startSec) / fromViewport.durationSec) * widthPx;
  const sw = widthPx * scale;
  ctx.drawImage(source, sx, 0, sw, heightPx, 0, 0, widthPx, heightPx);
}
