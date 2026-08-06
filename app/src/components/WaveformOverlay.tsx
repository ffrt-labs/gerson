import { memo, useEffect, useRef } from 'react';
import { drawPlayhead } from '../waveform/overlay.ts';
import { playheadX } from '../waveform/geometry.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';
import type { Viewport } from '../waveform/viewport.ts';

interface WaveformOverlayProps {
  position: number;
  viewport: Viewport;
  widthPx: number;
  heightPx: number;
  dpr: number;
}

// One absolutely-positioned canvas spanning all four rows (§5.3): the
// playhead is song-level, not track-level, so it lives apart from the four
// waveform bitmaps. This is the 60fps path — it redraws on every position
// or viewport change, but never touches a waveform canvas. When the
// playhead is outside the current viewport, playheadX maps it outside the
// canvas too, so it simply doesn't appear rather than being pinned to an
// edge it isn't at.
export const WaveformOverlay = memo(function WaveformOverlay({
  position,
  viewport,
  widthPx,
  heightPx,
  dpr,
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

    const x = playheadX(position, viewport, physicalWidth);
    drawPlayhead(ctx, x, physicalWidth, physicalHeight);
  }, [position, viewport, physicalWidth, physicalHeight, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-overlay"
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
