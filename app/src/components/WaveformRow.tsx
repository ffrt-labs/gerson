import { memo, useEffect, useRef, type MouseEvent } from 'react';
import type { Role } from '../domain/types.ts';
import { aggregatePeaksToWidth } from '../waveform/pixels.ts';
import { drawWaveform } from '../waveform/draw.ts';
import { secondsAtX } from '../waveform/geometry.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';

const MUTED_ALPHA = 0.35;

interface WaveformRowProps {
  role: Role;
  peaks: Int8Array | null;
  muted: boolean;
  durationSec: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
  onSeek: (seconds: number) => void;
}

// One canvas per stem row (§5.3): track state changes independently, so
// each row redraws on its own — muting a stem redraws that row alone,
// dimming its waveform, and never touches the other three canvases (each
// is its own memoized component with its own effect deps). Sized to
// devicePixelRatio and drawn entirely in that device-pixel space (no
// ctx.scale), so drawWaveform's column count is the physical pixel width.
export const WaveformRow = memo(function WaveformRow({
  role,
  peaks,
  muted,
  durationSec,
  widthPx,
  heightPx,
  dpr,
  onSeek,
}: WaveformRowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const physicalWidth = Math.round(widthPx * dpr);
  const physicalHeight = Math.round(heightPx * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = sizeCanvas(canvas, physicalWidth, physicalHeight);
    if (!ctx) return;

    ctx.strokeStyle = 'currentColor';
    ctx.lineWidth = 1;
    ctx.globalAlpha = muted ? MUTED_ALPHA : 1;

    const columns = peaks ? aggregatePeaksToWidth(peaks, physicalWidth) : [];
    drawWaveform(ctx, columns, physicalWidth, physicalHeight);
  }, [peaks, muted, physicalWidth, physicalHeight]);

  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const seconds = secondsAtX(e.clientX - rect.left, durationSec, rect.width);
    onSeek(seconds);
  };

  return (
    <canvas
      ref={canvasRef}
      className="waveform-row"
      role="img"
      aria-label={`${role} waveform`}
      style={{ width: widthPx, height: heightPx }}
      onClick={handleClick}
    />
  );
});
