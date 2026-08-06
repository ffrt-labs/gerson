import { memo, useEffect, useRef } from 'react';
import { drawPlayhead, drawLoopShading } from '../waveform/overlay.ts';
import { playheadX } from '../waveform/geometry.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';
import type { Viewport } from '../waveform/viewport.ts';
import type { LoopRegion } from '../domain/types.ts';

interface WaveformOverlayProps {
  position: number;
  viewport: Viewport;
  widthPx: number;
  heightPx: number;
  dpr: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
}

// One absolutely-positioned canvas spanning all four rows (§5.3): the
// playhead and the loop region are both song-level, not track-level, so
// they live apart from the four waveform bitmaps. This is the 60fps path —
// it redraws on every position or viewport change, but never touches a
// waveform canvas. When the playhead is outside the current viewport,
// playheadX maps it outside the canvas too, so it simply doesn't appear
// rather than being pinned to an edge it isn't at — the loop shading clips
// the same way. The region is drawn here read-only; it's only ever
// draggable from the dedicated LoopLane above the rows (§5.4).
export const WaveformOverlay = memo(function WaveformOverlay({
  position,
  viewport,
  widthPx,
  heightPx,
  dpr,
  loop,
  loopEnabled,
}: WaveformOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const physicalWidth = Math.round(widthPx * dpr);
  const physicalHeight = Math.round(heightPx * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = sizeCanvas(canvas, physicalWidth, physicalHeight);
    if (!ctx) return;
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = Math.max(1, dpr);

    // drawPlayhead clears the canvas — always called first, so the shading
    // composited after it isn't wiped by that clear.
    const x = playheadX(position, viewport, physicalWidth);
    drawPlayhead(ctx, x, physicalWidth, physicalHeight);

    if (loop) {
      const startX = playheadX(loop.startSec, viewport, physicalWidth);
      const endX = playheadX(loop.endSec, viewport, physicalWidth);
      drawLoopShading(ctx, startX, endX, physicalWidth, physicalHeight, loopEnabled);
    }
  }, [position, viewport, physicalWidth, physicalHeight, dpr, loop, loopEnabled]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-overlay"
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
