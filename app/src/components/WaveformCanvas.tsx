import { memo, useEffect, useRef } from 'react';
import type { Viewport } from '../waveform/viewport.ts';
import { aggregatePeaksForViewport } from '../waveform/pixels.ts';
import { drawWaveform } from '../waveform/draw.ts';
import { blitViewportShift } from '../waveform/blit.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';

interface WaveformCanvasProps {
  peaks: Int8Array | null;
  /** A `--wave-*` colour from waveform/colors.ts — never an ad-hoc string. */
  color: string;
  viewport: Viewport;
  sampleRate: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
  /** True only while a pan/zoom gesture is in flight; see the blit branch. */
  gesturing?: boolean;
  label: string;
  className?: string;
}

// One canvas of peaks, at whatever size the caller asks for: the Stage's
// tall full-mix waveform and each stem card's 34px strip are the same
// component with different heights and colours (handoff "Waveform
// rendering": the per-column min/max loop is unchanged, only the target
// height differs).
//
// Sized to devicePixelRatio and drawn entirely in that device-pixel space
// (no ctx.scale), so drawWaveform's column count is the physical pixel
// width. Pointer gestures live in the caller — the x-to-seconds mapping is
// the caller's viewport, so there is no reason for each canvas to own
// handlers.
export const WaveformCanvas = memo(function WaveformCanvas({
  peaks,
  color,
  viewport,
  sampleRate,
  widthPx,
  heightPx,
  dpr,
  gesturing = false,
  label,
  className,
}: WaveformCanvasProps) {
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

    // Off states lose colour rather than gaining a different one: a muted
    // stem is drawn in --wave-muted, not at reduced opacity, so the card's
    // controls stay fully legible beside it.
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(dpr));

    const columns = peaks ? aggregatePeaksForViewport(peaks, viewport, physicalWidth, sampleRate) : [];
    drawWaveform(ctx, columns, physicalWidth, physicalHeight);
    paintedViewportRef.current = viewport;
  }, [peaks, color, physicalWidth, physicalHeight, viewport, sampleRate, gesturing, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
      style={{ width: widthPx, height: heightPx }}
    />
  );
});
