import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ROLES, type LoopRegion, type PracticeState, type Role } from '../domain/types.ts';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { WaveformRow } from './WaveformRow.tsx';
import { WaveformOverlay } from './WaveformOverlay.tsx';
import { LoopLane } from './LoopLane.tsx';
import {
  type Viewport,
  fitTheSongViewport,
  clampViewport,
  zoomViewport,
  panViewport,
  followViewport,
  isPositionVisible,
  minVisibleDurationSec,
} from '../waveform/viewport.ts';
import { secondsAtX } from '../waveform/geometry.ts';

export const WAVEFORM_ROW_HEIGHT_PX = 64;

// A click that moves less than this is still a click, not a pan — matches
// the "click-to-seek stays unambiguous" rule (§5.4) by keeping the drag
// threshold small enough that no reasonable click accidentally pans.
const DRAG_THRESHOLD_PX = 4;

// Exponential rather than linear so a wheel notch always feels like "one
// step" of zoom regardless of the current span.
const WHEEL_ZOOM_SPEED = 0.002;

// No wheel event for this long reads as the gesture having ended — wheel
// has no native end event the way mouseup does for a drag.
const WHEEL_GESTURE_IDLE_MS = 200;

interface WaveformStackProps {
  peaks: Record<Role, Int8Array> | null;
  stems: PracticeState['stems'];
  durationSec: number;
  sampleRate: number;
  position: number;
  onSeek: (seconds: number) => void;
  loop: LoopRegion | null;
  loopEnabled: boolean;
  onChangeLoop: (region: LoopRegion) => void;
}

interface DragState {
  startClientX: number;
  startViewport: Viewport;
  containerWidthPx: number;
  containerLeftPx: number;
  dragged: boolean;
}

// Four stem-row canvases plus one overlay canvas spanning all of them
// (§5.3), stacked flush so the overlay's playhead line stays pixel-aligned
// with every row. Owns the viewport (§5.1 zoom, §5.2 pan/follow): Ctrl+wheel
// or a trackpad pinch zooms centered on the pointer, plain wheel/trackpad
// scroll pans, and click-drag on the waveform pans (a plain click still
// seeks — the one gesture §5.4 reserves for the waveform rows themselves).
export function WaveformStack({
  peaks,
  stems,
  durationSec,
  sampleRate,
  position,
  onSeek,
  loop,
  loopEnabled,
  onChangeLoop,
}: WaveformStackProps) {
  const [containerRef, widthPx] = useElementWidth<HTMLDivElement>();
  const [dpr] = useState(() => window.devicePixelRatio || 1);
  const heightPx = WAVEFORM_ROW_HEIGHT_PX * ROLES.length;
  const physicalWidth = Math.round(widthPx * dpr);

  const [viewportState, setViewport] = useState<Viewport>(() => fitTheSongViewport(durationSec));
  // Auto-follow (§5.2): armed by default, defeated by any pan/zoom gesture,
  // and re-armed only by the explicit Follow control. A Song change resets
  // both — but via remount (Player keys WaveformStack by song.id), not
  // logic here, so stale zoom/pan from a previous Song can't leak in.
  const [following, setFollowing] = useState(true);
  const [gesturing, setGesturing] = useState(false);
  const [prevPhysicalWidth, setPrevPhysicalWidth] = useState(physicalWidth);

  const minDurationSec = minVisibleDurationSec(physicalWidth, sampleRate);

  // Adjusting state during render, not in an effect (React's documented
  // pattern for deriving state from a changed input — avoids an extra
  // commit for what's otherwise a synchronous derivation).
  let viewport = viewportState;

  // The 1-pair/px floor is a function of pixel width, so a resize can move
  // it — re-clamp (never reset) so resizing mid-session doesn't lose the
  // user's place.
  if (physicalWidth !== prevPhysicalWidth) {
    setPrevPhysicalWidth(physicalWidth);
    viewport = clampViewport(viewport, durationSec, minDurationSec);
    setViewport(viewport);
  }

  // Auto-follow only acts once the playhead has actually left the viewport
  // (§5.2) — it never nudges a viewport the playhead is still inside, which
  // is what keeps the viewport still between gestures.
  if (following && !isPositionVisible(position, viewport)) {
    viewport = followViewport(viewport, position, durationSec, minDurationSec);
    setViewport(viewport);
  }

  const wheelIdleTimer = useRef<number | null>(null);
  const markGesturing = () => {
    setGesturing(true);
    if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current);
    wheelIdleTimer.current = window.setTimeout(() => setGesturing(false), WHEEL_GESTURE_IDLE_MS);
  };

  useEffect(() => {
    return () => {
      if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current);
    };
  }, []);

  // Registered natively (not React's onWheel) so preventDefault reliably
  // stops the page from scrolling while zooming/panning the waveform.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || widthPx <= 0) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();

      if (e.ctrlKey) {
        // Ctrl+wheel, or a trackpad pinch (which the browser reports as a
        // wheel event with ctrlKey set) — zoom, centered on the pointer.
        const focusSec = secondsAtX(e.clientX - rect.left, viewport, rect.width);
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
        setViewport(v => zoomViewport(v, factor, focusSec, durationSec, minDurationSec));
      } else {
        // Plain wheel or two-finger trackpad scroll — pan. Horizontal
        // scroll drives it when present; a vertical-only mouse wheel still
        // does something useful rather than nothing.
        const rawDeltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        const deltaSec = (rawDeltaPx / rect.width) * viewport.durationSec;
        setViewport(v => panViewport(v, deltaSec, durationSec, minDurationSec));
      }
      setFollowing(false);
      markGesturing();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, widthPx, viewport, durationSec, minDurationSec]);

  const dragRef = useRef<DragState | null>(null);

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const drag: DragState = {
      startClientX: e.clientX,
      startViewport: viewport,
      containerWidthPx: rect.width,
      containerLeftPx: rect.left,
      dragged: false,
    };
    dragRef.current = drag;

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - drag.startClientX;
      if (!drag.dragged) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
        drag.dragged = true;
        setFollowing(false);
        setGesturing(true);
      }
      const deltaSec = -(deltaX / drag.containerWidthPx) * drag.startViewport.durationSec;
      setViewport(panViewport(drag.startViewport, deltaSec, durationSec, minDurationSec));
    };

    const handleUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      dragRef.current = null;
      if (drag.dragged) {
        setGesturing(false);
      } else {
        const seconds = secondsAtX(upEvent.clientX - drag.containerLeftPx, drag.startViewport, drag.containerWidthPx);
        onSeek(seconds);
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleFollowClick = () => {
    setViewport(v => followViewport(v, position, durationSec, minDurationSec));
    setFollowing(true);
  };

  return (
    <div className="waveform-controls">
      <button
        type="button"
        className={following ? 'waveform-follow waveform-follow--active' : 'waveform-follow'}
        aria-pressed={following}
        onClick={handleFollowClick}
      >
        Follow
      </button>
      {/* Sibling of .waveform-stack, not nested inside it — the overlay
          below is absolutely positioned with inset:0 against .waveform-stack
          specifically, so the lane must stay outside that box or the
          shading canvas would stretch up to cover it too. */}
      <LoopLane
        loop={loop}
        loopEnabled={loopEnabled}
        viewport={viewport}
        widthPx={widthPx}
        durationSec={durationSec}
        dpr={dpr}
        onChangeLoop={onChangeLoop}
      />
      <div
        className="waveform-stack"
        ref={containerRef}
        style={{ height: heightPx }}
        onMouseDown={handleMouseDown}
      >
        {ROLES.map(role => (
          <WaveformRow
            key={role}
            role={role}
            peaks={peaks?.[role] ?? null}
            muted={stems[role].muted}
            viewport={viewport}
            sampleRate={sampleRate}
            widthPx={widthPx}
            heightPx={WAVEFORM_ROW_HEIGHT_PX}
            dpr={dpr}
            gesturing={gesturing}
          />
        ))}
        <WaveformOverlay
          position={position}
          viewport={viewport}
          widthPx={widthPx}
          heightPx={heightPx}
          dpr={dpr}
          loop={loop}
          loopEnabled={loopEnabled}
        />
      </div>
    </div>
  );
}
