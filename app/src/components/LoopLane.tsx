import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { LoopRegion } from '../domain/types.ts';
import type { Viewport } from '../waveform/viewport.ts';
import { secondsAtX, playheadX } from '../waveform/geometry.ts';
import { sizeCanvas } from '../waveform/sizeCanvas.ts';
import { drawLoopLane } from '../waveform/lane.ts';
import {
  hitTestLoopLane,
  dragToRegion,
  resizeStart,
  resizeEnd,
  moveRegion,
  clampRegionToDuration,
  type LoopDragMode,
} from '../waveform/loop.ts';

export const LOOP_LANE_HEIGHT_PX = 20;

// A grab within this many CSS pixels of an edge resizes it instead of
// starting a new region or moving the middle — a fixed screen-space
// tolerance (like WaveformStack's own DRAG_THRESHOLD_PX), not one that
// shrinks with zoom, so the edge stays just as grabbable at any span.
const EDGE_GRAB_PX = 8;

interface LoopLaneProps {
  loop: LoopRegion | null;
  loopEnabled: boolean;
  viewport: Viewport;
  widthPx: number;
  durationSec: number;
  dpr: number;
  onChangeLoop: (region: LoopRegion) => void;
}

interface DragState {
  mode: LoopDragMode;
  anchorSec: number; // 'create': the fixed edge. 'move': the point grabbed, for a pure delta.
  startRegion: LoopRegion | null; // the region as of mousedown — the opposite edge never moves mid-drag
}

// The dedicated loop lane (§5.4): a drag here is the only way to create,
// resize, or move the loop region — the four waveform rows underneath stay
// click-to-seek, unambiguous, because they never see this component's drag
// handlers. WaveformOverlay separately renders the same region as
// read-only shading through all four rows; this canvas is the interactive
// one, pixel-aligned with those rows by sharing their viewport and widthPx.
export function LoopLane({ loop, loopEnabled, viewport, widthPx, durationSec, dpr, onChangeLoop }: LoopLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const physicalWidth = Math.round(widthPx * dpr);
  const physicalHeight = Math.round(LOOP_LANE_HEIGHT_PX * dpr);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = sizeCanvas(canvas, physicalWidth, physicalHeight);
    if (!ctx) return;

    const region = loop
      ? {
          startXPx: playheadX(loop.startSec, viewport, physicalWidth),
          endXPx: playheadX(loop.endSec, viewport, physicalWidth),
        }
      : null;
    drawLoopLane(ctx, region, physicalWidth, physicalHeight, loopEnabled);
  }, [loop, loopEnabled, viewport, physicalWidth, physicalHeight]);

  const dragRef = useRef<DragState | null>(null);

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const downSec = secondsAtX(e.clientX - rect.left, viewport, rect.width);
    const edgeToleranceSec = (EDGE_GRAB_PX / rect.width) * viewport.durationSec;
    const mode = hitTestLoopLane(downSec, loop, edgeToleranceSec);

    const drag: DragState = { mode, anchorSec: downSec, startRegion: loop };
    dragRef.current = drag;

    // Nothing commits until the pointer actually moves — a plain click
    // (mousedown immediately followed by mouseup) never fires this, so it
    // stays a no-op rather than stamping a zero-length region.
    const handleMove = (moveEvent: MouseEvent) => {
      const currentSec = secondsAtX(moveEvent.clientX - rect.left, viewport, rect.width);
      let next: LoopRegion | null = null;

      switch (drag.mode) {
        case 'create':
          next = dragToRegion(drag.anchorSec, currentSec);
          break;
        case 'resize-start':
          if (drag.startRegion) next = resizeStart(drag.startRegion, currentSec);
          break;
        case 'resize-end':
          if (drag.startRegion) next = resizeEnd(drag.startRegion, currentSec, durationSec);
          break;
        case 'move':
          if (drag.startRegion) next = moveRegion(drag.startRegion, currentSec - drag.anchorSec, durationSec);
          break;
      }

      if (next) onChangeLoop(clampRegionToDuration(next, durationSec));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      className="loop-lane"
      style={{ width: widthPx, height: LOOP_LANE_HEIGHT_PX }}
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className="loop-lane-canvas" style={{ width: widthPx, height: LOOP_LANE_HEIGHT_PX }} />
    </div>
  );
}
