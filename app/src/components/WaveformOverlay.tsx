import { memo, useEffect, useRef } from 'react';
import { drawPlayhead } from '../waveform/overlay.ts';
import { playheadX } from '../waveform/geometry.ts';

interface WaveformOverlayProps {
  position: number;
  durationSec: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
}

// One absolutely-positioned canvas spanning all four rows (§5.3): the
// playhead is song-level, not track-level, so it lives apart from the four
// waveform bitmaps. This is the 60fps path — it redraws on every position
// change, but never touches a waveform canvas.
export const WaveformOverlay = memo(function WaveformOverlay({
  position,
  durationSec,
  widthPx,
  heightPx,
  dpr,
}: WaveformOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const physicalWidth = Math.round(widthPx * dpr);
  const physicalHeight = Math.round(heightPx * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || physicalWidth <= 0 || physicalHeight <= 0) return;
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = Math.max(1, dpr);

    const x = playheadX(position, durationSec, physicalWidth);
    drawPlayhead(ctx, x, physicalWidth, physicalHeight);
  }, [position, durationSec, physicalWidth, physicalHeight, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-overlay"
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
