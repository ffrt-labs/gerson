import { memo, useEffect, useRef } from 'react';
import { clearOverlay, drawPlayhead, drawLoopFocus } from '../waveform/overlay.ts';
import { playheadX } from '../waveform/geometry.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';
import type { Viewport } from '../waveform/viewport.ts';
import type { LoopRegion } from '../domain/types.ts';

// CSS pixels, scaled to device pixels below.
const PLAYHEAD_WIDTH_PX = 2;
const PLAYHEAD_CAP_PX = 7;

interface WaveformOverlayProps {
  position: number;
  viewport: Viewport;
  widthPx: number;
  heightPx: number;
  dpr: number;
  loop: LoopRegion | null;
  loopEnabled: boolean;
}

// One absolutely-positioned canvas over the Stage waveform (§5.3): the
// playhead and the loop region are both song-level, not stem-level, so they
// live apart from the waveform bitmap. This is the 60fps path — it redraws
// on every position or viewport change, but never touches the waveform
// canvas.
//
// Paint order is the point of the three separate calls: clear, then the
// loop focus (which scrims everything outside the region), then the
// playhead on top — a playhead drawn under the scrim would fade out
// exactly when the user is watching it approach the loop's edge.
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

    clearOverlay(ctx, physicalWidth, physicalHeight);

    if (loop) {
      const startX = playheadX(loop.startSec, viewport, physicalWidth);
      const endX = playheadX(loop.endSec, viewport, physicalWidth);
      drawLoopFocus(ctx, startX, endX, physicalWidth, physicalHeight, loopEnabled);
    }

    drawPlayhead(
      ctx,
      playheadX(position, viewport, physicalWidth),
      physicalWidth,
      physicalHeight,
      PLAYHEAD_WIDTH_PX * dpr,
      PLAYHEAD_CAP_PX * dpr,
    );
  }, [position, viewport, physicalWidth, physicalHeight, dpr, loop, loopEnabled]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-overlay"
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
