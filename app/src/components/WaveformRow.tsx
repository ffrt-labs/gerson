import { memo, useEffect, useRef, type MouseEvent } from 'react';
import type { Role } from '../domain/types.ts';
import { aggregatePeaksToWidth } from '../waveform/pixels.ts';
import { drawWaveform } from '../waveform/draw.ts';
import { secondsAtX } from '../waveform/geometry.ts';

interface WaveformRowProps {
  role: Role;
  peaks: Int8Array | null;
  durationSec: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
  onSeek: (seconds: number) => void;
}

// One canvas per stem row (§5.3): track state changes independently, so
// each row redraws on its own — muting a stem must never repaint the other
// three. Sized to devicePixelRatio and drawn entirely in that device-pixel
// space (no ctx.scale), so drawWaveform's column count is the physical
// pixel width.
export const WaveformRow = memo(function WaveformRow({
  role,
  peaks,
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
    if (!canvas || physicalWidth <= 0 || physicalHeight <= 0) return;
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = 'currentColor';
    ctx.lineWidth = 1;

    const columns = peaks ? aggregatePeaksToWidth(peaks, physicalWidth) : [];
    drawWaveform(ctx, columns, physicalWidth, physicalHeight);
  }, [peaks, physicalWidth, physicalHeight]);

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
