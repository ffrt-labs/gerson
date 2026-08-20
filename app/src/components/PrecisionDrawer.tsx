import { useState } from 'react';
import type { LoopRegion } from '../domain/types.ts';
import { LOOP_STEP_SEC } from '../waveform/loop.ts';

export type LoopField = 'start' | 'end' | 'length';

interface PrecisionDrawerProps {
  loop: LoopRegion | null;
  mono: boolean;
  onClose: () => void;
  onEditLoopField: (field: LoopField, value: number) => void;
  onNudgeRegion: (deltaSec: number) => void;
  onClearLoop: () => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onSeek: (seconds: number) => void;
  onSeekLoopStart: () => void;
  onToggleMono: () => void;
  onFocusField: (field: LoopField | null) => void;
}

const NUDGES: { label: string; icon: string; deltaSec: number }[] = [
  { label: '1.00', icon: 'fast_rewind', deltaSec: -1 },
  { label: '0.10', icon: 'chevron_left', deltaSec: -0.1 },
  { label: '0.10', icon: 'chevron_right', deltaSec: 0.1 },
  { label: '1.00', icon: 'fast_forward', deltaSec: 1 },
];

function LoopFieldWell({
  label,
  labelClass,
  value,
  disabled,
  onCommit,
  onFocus,
  onBlur,
  hint,
  action,
}: {
  label: string;
  labelClass?: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number) => void;
  onFocus: () => void;
  onBlur: () => void;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="precision-field">
      <span className={`legend ${labelClass ?? ''}`}>{label}</span>
      <div className="field-well">
        <input
          type="number"
          step={LOOP_STEP_SEC}
          value={value === null ? '' : value.toFixed(2)}
          disabled={disabled}
          aria-label={`Loop ${label.toLowerCase()} in seconds`}
          onChange={e => onCommit(Number(e.target.value))}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="stepper">
          <button
            type="button"
            aria-label={`Increase loop ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={() => value !== null && onCommit(value + LOOP_STEP_SEC)}
          >
            <span className="icon" aria-hidden="true">keyboard_arrow_up</span>
          </button>
          <button
            type="button"
            aria-label={`Decrease loop ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={() => value !== null && onCommit(value - LOOP_STEP_SEC)}
          >
            <span className="icon" aria-hidden="true">keyboard_arrow_down</span>
          </button>
        </div>
      </div>
      {action}
      {hint && <span className="precision-hint">{hint}</span>}
    </div>
  );
}

/**
 * The precision drawer (design 2b): the numeric side of the loop region,
 * plus the two device-level playback settings.
 *
 * These controls used to sit permanently in the middle of the Player, where
 * three number inputs competed for attention with the transport. They are
 * load-bearing — placing an edge by ear is the point of the loop — but they
 * are not what the user looks at while playing, so they live one press
 * away.
 */
export function PrecisionDrawer({
  loop,
  mono,
  onClose,
  onEditLoopField,
  onNudgeRegion,
  onClearLoop,
  onSetLoopStart,
  onSetLoopEnd,
  onSeek,
  onSeekLoopStart,
  onToggleMono,
  onFocusField,
}: PrecisionDrawerProps) {
  const [jumpTo, setJumpTo] = useState('0');

  const noRegion = loop === null;

  return (
    <section className="precision" role="region" aria-label="Precision">
      <header className="precision-header">
        <span className="icon" aria-hidden="true">tune</span>
        <span className="legend">Precision</span>
        <button type="button" className="btn btn--ghost btn--dense precision-hide" onClick={onClose}>
          Hide
        </button>
      </header>

      <div className="precision-groups">
        <div className="precision-group">
          <span className="legend legend--sm">Loop region, seconds</span>
          <div className="precision-fields">
            <LoopFieldWell
              label="Start"
              labelClass="precision-label--loop"
              value={loop ? loop.startSec : null}
              disabled={noRegion}
              onCommit={v => onEditLoopField('start', v)}
              onFocus={() => onFocusField('start')}
              onBlur={() => onFocusField(null)}
              action={
                <button type="button" className="btn btn--secondary btn--dense" onClick={onSetLoopStart}>
                  From playhead
                </button>
              }
            />
            <LoopFieldWell
              label="End"
              labelClass="precision-label--loop"
              value={loop ? loop.endSec : null}
              disabled={noRegion}
              onCommit={v => onEditLoopField('end', v)}
              onFocus={() => onFocusField('end')}
              onBlur={() => onFocusField(null)}
              action={
                <button type="button" className="btn btn--secondary btn--dense" onClick={onSetLoopEnd}>
                  From playhead
                </button>
              }
            />
            <LoopFieldWell
              label="Length"
              value={loop ? loop.endSec - loop.startSec : null}
              disabled={noRegion}
              onCommit={v => onEditLoopField('length', v)}
              onFocus={() => onFocusField('length')}
              onBlur={() => onFocusField(null)}
              hint="moves End"
            />
          </div>
        </div>

        <div className="precision-divider" role="presentation" />

        <div className="precision-group">
          <span className="legend legend--sm">Nudge the region</span>
          <div className="precision-nudges">
            {NUDGES.map(nudge => (
              <button
                type="button"
                key={nudge.deltaSec}
                className="btn btn--secondary precision-nudge"
                disabled={noRegion}
                aria-label={`Move the loop region ${nudge.deltaSec > 0 ? 'later' : 'earlier'} by ${nudge.label} seconds`}
                onClick={() => onNudgeRegion(nudge.deltaSec)}
              >
                <span className="icon" aria-hidden="true">{nudge.icon}</span>
                <span className="mono">{nudge.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--dense"
            disabled={noRegion}
            onClick={onClearLoop}
          >
            Clear the loop
          </button>
        </div>

        <div className="precision-divider" role="presentation" />

        <div className="precision-group">
          <span className="legend legend--sm">Jump to</span>
          <div className="precision-jump">
            <div className="field-well">
              <input
                type="number"
                step={LOOP_STEP_SEC}
                value={jumpTo}
                aria-label="Jump to, in seconds"
                onChange={e => setJumpTo(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                const seconds = Number(jumpTo);
                if (Number.isFinite(seconds)) onSeek(seconds);
              }}
            >
              Go
            </button>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--dense"
            disabled={noRegion}
            onClick={onSeekLoopStart}
          >
            Back to loop start
          </button>
        </div>

        <div className="precision-divider" role="presentation" />

        <div className="precision-group">
          <span className="legend legend--sm">Playback</span>
          <div className="precision-mono">
            <button
              type="button"
              className="switch"
              style={{ '--switch-w': '48px', '--switch-h': '28px' } as React.CSSProperties}
              role="switch"
              aria-checked={mono}
              aria-label="Mono"
              onClick={onToggleMono}
            />
            <span className="precision-mono-label">Mono</span>
          </div>
          <p className="precision-copy">
            Halves the memory a Song needs to play. Helps on phones and older machines.
          </p>
          {/* The hints must not lie — every binding here is bound in Player. */}
          <span className="legend legend--sm precision-shortcuts">
            Space play · [ ] set A B · L loop · arrows nudge · 1–4 mute
          </span>
        </div>
      </div>
    </section>
  );
}
