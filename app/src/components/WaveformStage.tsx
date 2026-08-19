import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LoopRegion } from '../domain/types.ts';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.ts';
import { useCompactLayout } from '../hooks/useCompactLayout.ts';
import { WaveformCanvas } from './WaveformCanvas.tsx';
import { WaveformOverlay } from './WaveformOverlay.tsx';
import { LoopLane } from './LoopLane.tsx';
import { WAVE_NEUTRAL } from '../waveform/colors.ts';
import { rulerTicks } from '../waveform/ruler.ts';
import { formatClock, formatTimecode, formatLengthSec } from '../format/units.ts';
import {
  type Viewport,
  fitTheSongViewport,
  clampViewport,
  zoomViewport,
  panViewport,
  followViewport,
  followIfNeeded,
  minVisibleDurationSec,
} from '../waveform/viewport.ts';
import { secondsAtX, playheadX } from '../waveform/geometry.ts';

export const STAGE_WAVEFORM_HEIGHT_PX = 316;
// Design 2d: on a phone the waveform is a strip, not a stage — the screen
// has to fit the stem grid and the transport as well.
export const STAGE_WAVEFORM_HEIGHT_COMPACT_PX = 96;
export const STAGE_RULER_HEIGHT_PX = 26;

// One tick per this many seconds along the ruler, matching the design's
// fit-the-song spacing. Fixed rather than adaptive: at any zoom the ruler is
// an orientation aid, not a measuring device — the numeric loop fields in
// the precision drawer are where exact times are read.
const RULER_INTERVAL_SEC = 50;

// A click that moves less than this is still a click, not a drag — keeps
// click-to-seek unambiguous (§5.4) without making a deliberate scrub hard.
const DRAG_THRESHOLD_PX = 4;

// Exponential rather than linear so a wheel notch always feels like "one
// step" of zoom regardless of the current span.
const WHEEL_ZOOM_SPEED = 0.002;

// What one press of a zoom button is worth, in the same exponential terms.
const ZOOM_BUTTON_FACTOR = 1.6;

// No wheel event for this long reads as the gesture having ended — wheel
// has no native end event the way mouseup does for a drag.
const WHEEL_GESTURE_IDLE_MS = 200;

interface WaveformStageProps {
  peaks: Int8Array | null;
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

/**
 * The waveform stage (design 1a): a caption row carrying the loop readout
 * and the view controls, over a well holding three bands — the interactive
 * loop lane, the full-mix waveform, and the time ruler.
 *
 * Owns the viewport (§5.1 zoom, §5.2 pan/follow) for all three: Ctrl+wheel
 * or a trackpad pinch zooms centred on the pointer, plain wheel scroll and
 * click-drag pan, and a plain click seeks. The single mix waveform replaces
 * the four stacked stem rows — per-stem waveforms now live on the stem
 * cards below.
 */
export function WaveformStage({
  peaks,
  durationSec,
  sampleRate,
  position,
  onSeek,
  loop,
  loopEnabled,
  onChangeLoop,
}: WaveformStageProps) {
  const [containerRef, widthPx] = useElementWidth<HTMLDivElement>();
  const dpr = useDevicePixelRatio();
  const compact = useCompactLayout();
  const waveformHeight = compact ? STAGE_WAVEFORM_HEIGHT_COMPACT_PX : STAGE_WAVEFORM_HEIGHT_PX;
  const physicalWidth = Math.round(widthPx * dpr);

  const [viewportState, setViewport] = useState<Viewport>(() => fitTheSongViewport(durationSec));
  // Auto-follow (§5.2): armed by default, defeated by any pan/zoom gesture,
  // and re-armed only by the explicit Follow control. A Song change resets
  // both — but via remount (Player keys the stage by song.id), not logic
  // here, so stale zoom/pan from a previous Song can't leak in.
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
  // is what keeps the viewport still between gestures. `followIfNeeded`
  // owns the whole decision, including whether following is possible at all
  // (see its contract: it must return null for the viewport it just
  // returned, or this render loops).
  const followed = following ? followIfNeeded(viewport, position, durationSec, minDurationSec) : null;
  if (followed) {
    viewport = followed;
    setViewport(followed);
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
        // wheel event with ctrlKey set) — zoom, centred on the pointer.
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
      if (drag.dragged) {
        setGesturing(false);
      } else {
        onSeek(secondsAtX(upEvent.clientX - drag.containerLeftPx, drag.startViewport, drag.containerWidthPx));
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  // Follow re-arms and jumps to the playhead in one press; turning it off
  // leaves the view exactly where the user put it.
  const toggleFollow = () => {
    if (following) {
      setFollowing(false);
      return;
    }
    setViewport(v => followViewport(v, position, durationSec, minDurationSec));
    setFollowing(true);
  };

  // Zoom buttons work on the centre of the current view, the only focus
  // point a keyboard or button press has.
  const zoomBy = (factor: number) => {
    setFollowing(false);
    setViewport(v =>
      zoomViewport(v, factor, v.startSec + v.durationSec / 2, durationSec, minDurationSec),
    );
  };

  const ticks = rulerTicks(viewport, widthPx, RULER_INTERVAL_SEC);
  const playheadTickX = playheadX(position, viewport, widthPx);
  const loopLength = loop ? loop.endSec - loop.startSec : 0;

  return (
    <section className="stage">
      <div className="stage-caption">
        <span className="legend">Loop region</span>
        {loop ? (
          <span className="stage-caption-values mono">
            {formatTimecode(loop.startSec)}
            {/* The Material Symbols glyph, not "→": Google's latin subset of
                Sora and JetBrains Mono covers U+2191 and U+2193 but not
                U+2192, so a literal arrow drops to a system face in the
                middle of an otherwise mono readout. */}
            <span className="icon stage-caption-arrow" aria-label="to">arrow_forward</span>
            {formatTimecode(loop.endSec)} · {formatLengthSec(loopLength)}
          </span>
        ) : (
          <span className="stage-caption-empty">Drag the lane below to set one</span>
        )}
        <div className="stage-view-controls">
          <button
            type="button"
            className={`btn btn--secondary btn--dense stage-follow${following ? ' is-engaged' : ''}`}
            aria-pressed={following}
            onClick={toggleFollow}
          >
            <span className="icon" aria-hidden="true">my_location</span>
            Follow
          </button>
          <div className="stage-zoom">
            <button type="button" onClick={() => zoomBy(1 / ZOOM_BUTTON_FACTOR)} aria-label="Zoom out">
              <span className="icon" aria-hidden="true">zoom_out</span>
            </button>
            <button type="button" onClick={() => zoomBy(ZOOM_BUTTON_FACTOR)} aria-label="Zoom in">
              <span className="icon" aria-hidden="true">zoom_in</span>
            </button>
          </div>
        </div>
      </div>

      <div className="stage-well" ref={containerRef}>
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
          className="stage-waveform"
          style={{ height: waveformHeight }}
          onMouseDown={handleMouseDown}
        >
          <WaveformCanvas
            peaks={peaks}
            color={WAVE_NEUTRAL}
            viewport={viewport}
            sampleRate={sampleRate}
            widthPx={widthPx}
            heightPx={waveformHeight}
            dpr={dpr}
            gesturing={gesturing}
            label="Full mix waveform"
          />
          <WaveformOverlay
            position={position}
            viewport={viewport}
            widthPx={widthPx}
            heightPx={waveformHeight}
            dpr={dpr}
            loop={loop}
            loopEnabled={loopEnabled}
          />
        </div>
        <div className="stage-ruler" style={{ height: STAGE_RULER_HEIGHT_PX }} aria-hidden="true">
          {ticks.map(tick => (
            <span key={tick.seconds} className="stage-ruler-tick mono" style={{ left: tick.xPx }}>
              {formatClock(tick.seconds)}
            </span>
          ))}
          {playheadTickX >= 0 && playheadTickX <= widthPx && (
            <span className="stage-ruler-playhead" style={{ left: playheadTickX }} />
          )}
        </div>
      </div>
    </section>
  );
}
