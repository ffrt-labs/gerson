import { memo, useEffect, useRef } from 'react';
import type { Role } from '../domain/types.ts';
import type { Viewport } from '../waveform/viewport.ts';
import { aggregatePeaksForViewport } from '../waveform/pixels.ts';
import { drawWaveform } from '../waveform/draw.ts';
import { blitViewportShift } from '../waveform/blit.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';

const MUTED_ALPHA = 0.35;

interface WaveformRowProps {
  role: Role;
  peaks: Int8Array | null;
  muted: boolean;
  viewport: Viewport;
  sampleRate: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
  gesturing: boolean;
}

// One canvas per stem row (§5.3): track state changes independently, so
// each row redraws on its own — muting a stem redraws that row alone,
// dimming its waveform, and never touches the other three canvases (each
// is its own memoized component with its own effect deps). Sized to
// devicePixelRatio and drawn entirely in that device-pixel space (no
// ctx.scale), so drawWaveform's column count is the physical pixel width.
//
// Click-to-seek and pan/zoom gestures live one level up in WaveformStack —
// the x-to-seconds mapping is identical across all four rows, so there's no
// reason for each row to own its own pointer handlers.
export const WaveformRow = memo(function WaveformRow({
  role,
  peaks,
  muted,
  viewport,
  sampleRate,
  widthPx,
  heightPx,
  dpr,
  gesturing,
}: WaveformRowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The viewport currently painted into the canvas's pixels — tracked
  // separately from the `viewport` prop because during a gesture the canvas
  // lags one blit behind the live viewport (§5.3): each tick blits from
  // whatever is already on screen, and only catches up with a sharp
  // re-render once the gesture ends.
  const paintedViewportRef = useRef<Viewport | null>(null);

  const physicalWidth = Math.round(widthPx * dpr);
  const physicalHeight = Math.round(heightPx * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painted = paintedViewportRef.current;
    const sizeUnchanged = canvas.width === physicalWidth && canvas.height === physicalHeight;

    if (gesturing && painted && sizeUnchanged) {
      // Mid-gesture: blit the existing bitmap rather than recomputing from
      // peaks — one GPU-friendly drawImage, softening slightly across the
      // gesture, corrected by the sharp branch below once it ends.
      const ctx = canvas.getContext('2d');
      if (ctx) {
        blitViewportShift(ctx, canvas, painted, viewport, physicalWidth, physicalHeight);
        paintedViewportRef.current = viewport;
        return;
      }
    }

    const ctx = sizeCanvas(canvas, physicalWidth, physicalHeight);
    if (!ctx) return;

    ctx.strokeStyle = 'currentColor';
    ctx.lineWidth = 1;
    ctx.globalAlpha = muted ? MUTED_ALPHA : 1;

    const columns = peaks ? aggregatePeaksForViewport(peaks, viewport, physicalWidth, sampleRate) : [];
    drawWaveform(ctx, columns, physicalWidth, physicalHeight);
    paintedViewportRef.current = viewport;
  }, [peaks, muted, physicalWidth, physicalHeight, viewport, sampleRate, gesturing]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-row"
      role="img"
      aria-label={`${role} waveform`}
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
