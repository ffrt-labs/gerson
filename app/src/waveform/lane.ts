/**
 * Draws the dedicated loop lane's own canvas (§5.4) — the strip above the
 * four waveform rows where a drag creates, resizes, or moves the region.
 * This is the only canvas that's actually interactive for loop editing; the
 * shading in the four-row overlay (waveform/overlay.ts) is a read-only
 * reflection of the same region. Pixel-for-pixel x alignment with the rows
 * comes from the caller passing the same viewport-derived x coordinates —
 * this module has no opinion on seconds, only pixels.
 */

import type { Canvas2DLike } from './canvas.ts';

export interface LoopLaneRegionPx {
  readonly startXPx: number;
  readonly endXPx: number;
}

const HANDLE_WIDTH_PX = 2;

export function drawLoopLane(
  ctx: Canvas2DLike,
  region: LoopLaneRegionPx | null,
  widthPx: number,
  heightPx: number,
  enabled: boolean,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  if (heightPx <= 0 || !region) return;

  const left = Math.max(0, Math.min(region.startXPx, region.endXPx));
  const right = Math.min(widthPx, Math.max(region.startXPx, region.endXPx));
  if (right <= left) return;

  ctx.fillStyle = enabled ? 'rgba(217, 164, 65, 0.45)' : 'rgba(217, 164, 65, 0.25)';
  ctx.fillRect(left, 0, right - left, heightPx);

  // A brighter hairline at each edge that's actually visible — the grab
  // handle's affordance. An edge outside the canvas draws no handle,
  // matching the fill's own clip rather than pinning it to a border it
  // isn't at.
  ctx.fillStyle = '#d9a441';
  if (region.startXPx >= 0 && region.startXPx <= widthPx) {
    ctx.fillRect(region.startXPx - HANDLE_WIDTH_PX / 2, 0, HANDLE_WIDTH_PX, heightPx);
  }
  if (region.endXPx >= 0 && region.endXPx <= widthPx) {
    ctx.fillRect(region.endXPx - HANDLE_WIDTH_PX / 2, 0, HANDLE_WIDTH_PX, heightPx);
  }
}
