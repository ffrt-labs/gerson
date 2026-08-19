import { useState } from 'react';
import type { Role, StemState } from '../domain/types.ts';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.ts';
import { WaveformCanvas } from './WaveformCanvas.tsx';
import { WAVE_STEM, WAVE_MUTED, WAVE_SOLO } from '../waveform/colors.ts';
import { fitTheSongViewport } from '../waveform/viewport.ts';
import { formatGain } from '../format/units.ts';
import { ROLE_ICONS, ROLE_LABELS } from './roles.ts';

const STEM_WAVEFORM_HEIGHT_PX = 34;

// Unchanged from before the redesign — this is Practice state, not
// presentation (§4).
const MIN_GAIN = 0;
const MAX_GAIN = 1.5;

interface StemCardProps {
  role: Role;
  index: number;
  stem: StemState;
  solo: boolean;
  peaks: Int8Array | null;
  durationSec: number;
  sampleRate: number;
  onChangeGain: (role: Role, gain: number) => void;
  onToggleMuted: (role: Role) => void;
  onToggleSolo: (role: Role) => void;
}

/**
 * One Stem's card on the Stage: its own waveform, its level, and its two
 * toggles.
 *
 * A muted card dims its icon and name and desaturates its waveform, but
 * the card itself never drops opacity — the controls have to stay fully
 * legible while muted, since muting is exactly when the user reaches for
 * them again. Off states lose colour; they never gain a different one.
 *
 * The mini waveform always shows the whole Stem, deliberately ignoring the
 * Stage's zoom: it is an identifying glance ("which one is the bass?"), not
 * a second place to read the same position.
 */
export function StemCard({
  role,
  index,
  stem,
  solo,
  peaks,
  durationSec,
  sampleRate,
  onChangeGain,
  onToggleMuted,
  onToggleSolo,
}: StemCardProps) {
  const [waveRef, waveWidth] = useElementWidth<HTMLDivElement>();
  const dpr = useDevicePixelRatio();
  // Fixed at mount: the whole Stem, always. Keyed by song.id upstream, so
  // opening a different Song rebuilds it rather than keeping a stale span.
  const [viewport] = useState(() => fitTheSongViewport(durationSec));

  const waveColor = stem.muted ? WAVE_MUTED : solo ? WAVE_SOLO : WAVE_STEM;
  const gainPercent = ((stem.gain - MIN_GAIN) / (MAX_GAIN - MIN_GAIN)) * 100;

  const classes = ['stem-card'];
  if (stem.muted) classes.push('stem-card--muted');
  if (solo) classes.push('stem-card--solo');

  return (
    <article className={classes.join(' ')}>
      <header className="stem-card-header">
        <span className="icon stem-card-icon" aria-hidden="true">{ROLE_ICONS[role]}</span>
        <h3 className="stem-card-name">{ROLE_LABELS[role]}</h3>
        {/* Every engaged control carries a word, not just a colour. The
            neutral "On" is mobile-only (design 2d shows a state word on
            every card): on desktop the Mute and Solo buttons are right
            there unpressed, so a badge saying nothing is happening would be
            noise on all four cards at once. */}
        {stem.muted ? (
          <span className="badge badge--loop">Muted</span>
        ) : solo ? (
          <span className="badge badge--accent">Solo</span>
        ) : (
          <span className="badge stem-card-state-on">On</span>
        )}
        <span className="stem-card-index mono" aria-hidden="true">{index + 1}</span>
      </header>

      <div className="stem-card-wave" ref={waveRef}>
        <WaveformCanvas
          peaks={peaks}
          color={waveColor}
          viewport={viewport}
          sampleRate={sampleRate}
          widthPx={waveWidth}
          heightPx={STEM_WAVEFORM_HEIGHT_PX}
          dpr={dpr}
          label={`${ROLE_LABELS[role]} waveform`}
        />
      </div>

      {/* --fill sits on the wrapper, not the input: custom properties
          inherit, so the slider still reads it, and the mobile layout — which
          hides the input and shows the wrapper itself as a 5px level bar —
          can read it too. */}
      <div className="stem-card-gain" style={{ '--fill': `${gainPercent}%` } as React.CSSProperties}>
        <input
          className="slider"
          type="range"
          min={MIN_GAIN}
          max={MAX_GAIN}
          step={0.01}
          value={stem.gain}
          aria-label={`${ROLE_LABELS[role]} level`}
          onChange={e => onChangeGain(role, Number(e.target.value))}
        />
        <span className="stem-card-gain-value mono">{formatGain(stem.gain)}</span>
      </div>

      <div className="stem-card-toggles">
        <button
          type="button"
          className={`btn btn--secondary btn--toggle-tap${stem.muted ? ' is-engaged is-engaged--loop' : ''}`}
          aria-pressed={stem.muted}
          onClick={() => onToggleMuted(role)}
        >
          <span className="icon" aria-hidden="true">{stem.muted ? 'volume_off' : 'volume_up'}</span>
          Mute
        </button>
        <button
          type="button"
          className={`btn btn--secondary btn--toggle-tap${solo ? ' is-engaged' : ''}`}
          aria-pressed={solo}
          onClick={() => onToggleSolo(role)}
        >
          <span className="icon" aria-hidden="true">headphones</span>
          Solo
        </button>
      </div>
    </article>
  );
}
