import { useState } from 'react';
import { ROLES, type Role } from '../domain/types.ts';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { WaveformRow } from './WaveformRow.tsx';
import { WaveformOverlay } from './WaveformOverlay.tsx';

export const WAVEFORM_ROW_HEIGHT_PX = 64;

interface WaveformStackProps {
  peaks: Record<Role, Int8Array> | null;
  durationSec: number;
  position: number;
  onSeek: (seconds: number) => void;
}

// Four stem-row canvases plus one overlay canvas spanning all of them
// (§5.3), stacked flush so the overlay's playhead line stays pixel-aligned
// with every row. Fit-the-song only — the viewport is exactly the
// container's width; zoom and pan are #28.
export function WaveformStack({ peaks, durationSec, position, onSeek }: WaveformStackProps) {
  const [containerRef, widthPx] = useElementWidth<HTMLDivElement>();
  const [dpr] = useState(() => window.devicePixelRatio || 1);
  const heightPx = WAVEFORM_ROW_HEIGHT_PX * ROLES.length;

  return (
    <div className="waveform-stack" ref={containerRef} style={{ height: heightPx }}>
      {ROLES.map(role => (
        <WaveformRow
          key={role}
          role={role}
          peaks={peaks?.[role] ?? null}
          durationSec={durationSec}
          widthPx={widthPx}
          heightPx={WAVEFORM_ROW_HEIGHT_PX}
          dpr={dpr}
          onSeek={onSeek}
        />
      ))}
      <WaveformOverlay
        position={position}
        durationSec={durationSec}
        widthPx={widthPx}
        heightPx={heightPx}
        dpr={dpr}
      />
    </div>
  );
}
