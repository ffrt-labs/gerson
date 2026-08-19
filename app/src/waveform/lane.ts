/**
 * Draws the loop lane's canvas (§5.4) — the 30px strip above the Stage
 * waveform where a drag creates, resizes, or moves the region.
 *
 * The canvas draws the region *fill only*. The A and B handles are DOM
 * elements positioned over this canvas by LoopLane, because each carries
 * its own letter: a letter painted here, or positioned as a separate span,
 * drifts off the amber as the region moves and becomes illegible against
 * the waveform behind it. Keeping the letter a child of the handle is what
 * makes that impossible.
 *
 * Pixel-for-pixel x alignment with the waveform comes from the caller
 * passing the same viewport-derived x coordinates — this module has no
 * opinion on seconds, only pixels.
 */

import type { Canvas2DLike } from './canvas.ts';
import { LOOP_REGION_FILL, LOOP_REGION_FILL_OFF } from './colors.ts';

export interface LoopLaneRegionPx {
  readonly startXPx: number;
  readonly endXPx: number;
}

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

  // Dimmer when the loop is toggled off, so the region reads as "still set,
  // not currently repeating" (§5.4: toggling off must not look like losing
  // it).
  ctx.fillStyle = enabled ? LOOP_REGION_FILL : LOOP_REGION_FILL_OFF;
  ctx.fillRect(left, 0, right - left, heightPx);
}
