import { formatRate, formatTimecode } from '../format/units.ts';

// Unchanged from before the redesign — Practice state, not presentation.
const MIN_RATE = 0.5;
const MAX_RATE = 2;

interface TransportDockProps {
  playing: boolean;
  position: number;
  durationSec: number;
  tempo: number;
  loopEnabled: boolean;
  precisionOpen: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: (deltaSec: number) => void;
  onChangeRate: (rate: number) => void;
  onResetRate: () => void;
  onToggleLoop: () => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onTogglePrecision: () => void;
}

// One press of a stepper. Fine enough to chase a passage down a little at a
// time, coarse enough that holding the button gets somewhere.
const RATE_STEP = 0.05;

// The transport skip, in seconds. Ten, because the icons that name it are
// `replay_10` / `forward_10` — a skip whose glyph says 10 and whose
// behaviour says something else is a hint that lies.
const SKIP_SEC = 10;

function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/**
 * The transport dock (design 1a): three groups — play and timecode, tempo,
 * and loop — separated by full-height dividers.
 *
 * Tempo is the widest group because slowing a passage down is the reason
 * the app exists; in the old UI it was one unlabelled range input among
 * several and looked identical to everything else. It is always a
 * multiplier, never BPM: Gerson has no notion of a Song's beats.
 */
export function TransportDock({
  playing,
  position,
  durationSec,
  tempo,
  loopEnabled,
  precisionOpen,
  onPlay,
  onPause,
  onSkip,
  onChangeRate,
  onResetRate,
  onToggleLoop,
  onSetLoopStart,
  onSetLoopEnd,
  onTogglePrecision,
}: TransportDockProps) {
  const tempoPercent = ((tempo - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100;
  const detentPercent = ((1 - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100;

  return (
    <div className="dock">
      <div className="dock-group dock-group--transport">
        {/* Desktop has the waveform to click and Space to press; these are
            for the mobile layout, where neither is true (design 2d). */}
        <button
          type="button"
          className="btn btn--secondary dock-skip"
          aria-label={`Back ${SKIP_SEC} seconds`}
          onClick={() => onSkip(-SKIP_SEC)}
        >
          <span className="icon" aria-hidden="true">replay_10</span>
        </button>
        <div className="dock-play">
          <button
            type="button"
            className="dock-play-button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={playing ? onPause : onPlay}
          >
            <span className="icon" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
          </button>
          <span className="dock-play-hint mono" aria-hidden="true">Space</span>
        </div>
        <button
          type="button"
          className="btn btn--secondary dock-skip"
          aria-label={`Forward ${SKIP_SEC} seconds`}
          onClick={() => onSkip(SKIP_SEC)}
        >
          <span className="icon" aria-hidden="true">forward_10</span>
        </button>
        <div className="dock-timecode">
          <span className="dock-timecode-now mono">{formatTimecode(position)}</span>
          <span className="dock-timecode-total mono">/ {formatTimecode(durationSec)}</span>
        </div>
      </div>

      <div className="dock-divider" role="presentation" />

      <div className="dock-group dock-group--tempo">
        <div className="dock-tempo-legend">
          <span className="icon" aria-hidden="true">speed</span>
          <span className="legend">Tempo</span>
          <span className="dock-tempo-value mono">{formatRate(tempo)}</span>
          <span className="dock-tempo-note">pitch held</span>
          <button
            type="button"
            className="btn btn--ghost btn--dense dock-tempo-reset"
            onClick={onResetRate}
            disabled={tempo === 1}
          >
            Reset 1.00×
          </button>
        </div>
        <div className="dock-tempo-control">
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            aria-label="Slower"
            onClick={() => onChangeRate(clampRate(tempo - RATE_STEP))}
            disabled={tempo <= MIN_RATE}
          >
            <span className="icon" aria-hidden="true">remove</span>
          </button>
          <span className="dock-tempo-end mono">0.50×</span>
          <div className="dock-tempo-slider">
            <input
              className="slider slider--tempo"
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={0.01}
              value={tempo}
              style={{ '--fill': `${tempoPercent}%` } as React.CSSProperties}
              aria-label="Tempo"
              onChange={e => onChangeRate(Number(e.target.value))}
            />
            {/* The 1.00× detent: the one value worth finding by feel. */}
            <span className="dock-tempo-detent" style={{ left: `${detentPercent}%` }} aria-hidden="true" />
          </div>
          <span className="dock-tempo-end mono">2.00×</span>
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            aria-label="Faster"
            onClick={() => onChangeRate(clampRate(tempo + RATE_STEP))}
            disabled={tempo >= MAX_RATE}
          >
            <span className="icon" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      <div className="dock-divider" role="presentation" />

      <div className="dock-group dock-group--loop">
        <button
          type="button"
          className={`btn btn--secondary dock-loop${loopEnabled ? ' is-engaged is-engaged--loop' : ''}`}
          aria-pressed={loopEnabled}
          onClick={onToggleLoop}
        >
          <span className="icon" aria-hidden="true">{loopEnabled ? 'repeat_on' : 'repeat'}</span>
          {loopEnabled ? 'Loop on' : 'Loop'}
        </button>
        <div className="dock-loop-actions">
          <button type="button" className="btn btn--secondary btn--dense dock-set-bound" onClick={onSetLoopStart}>
            Set A <span className="mono">[</span>
          </button>
          <button type="button" className="btn btn--secondary btn--dense dock-set-bound" onClick={onSetLoopEnd}>
            Set B <span className="mono">]</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--dense dock-precision"
            aria-expanded={precisionOpen}
            onClick={onTogglePrecision}
          >
            <span className="icon" aria-hidden="true">tune</span>
            Precision
            <span className="icon" aria-hidden="true">
              {precisionOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
