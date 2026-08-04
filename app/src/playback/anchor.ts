/**
 * Pure transport-state math shared by all four stretcher nodes. Kept free of
 * AudioContext/AudioWorkletNode so the two footguns below are enforced by
 * construction and unit-testable without a browser. See spec §4.2.
 *
 * Footgun 1 — `output` and `outputTime` must be the identical absolute
 * AudioContext time, or `schedule()`'s internal timeline bookkeeping (which
 * reads `outputTime`) disagrees with the time actually written into the
 * node's segment (`output`), and the four nodes drift apart.
 *
 * Footgun 2 — `input` is an absolute seek. It must be present only when the
 * transition IS a seek; sending it on a rate or pause change teleports
 * playback.
 *
 * Position is never accumulated: every transition recomputes the absolute
 * input-buffer position from the *previous* anchor and the clock, rather
 * than adding a delta onto a running total.
 */

export interface ScheduleAnchor {
  readonly output: number;
  readonly outputTime: number;
  readonly active: boolean;
  readonly rate: number;
  readonly input?: number;
}

export interface TransportState {
  readonly anchor: ScheduleAnchor;
  // The absolute input-buffer position implied at anchor.output. Tracked
  // separately from anchor.input because the anchor only carries `input`
  // when the transition was a seek (footgun 2) — this is always known.
  readonly resolvedInput: number;
}

export const initialTransportState: TransportState = {
  anchor: { output: 0, outputTime: 0, active: false, rate: 1 },
  resolvedInput: 0,
};

// The input-buffer position implied by a state at a given AudioContext time
// — recomputed from the anchor, not accumulated, so it stays exact across
// any number of prior rate changes.
export function inputAt(state: TransportState, atTime: number): number {
  const { anchor, resolvedInput } = state;
  if (!anchor.active) return resolvedInput;
  return resolvedInput + (atTime - anchor.output) * anchor.rate;
}

function transition(
  previous: TransportState,
  atTime: number,
  active: boolean,
  rate: number,
  seekToSeconds?: number,
): TransportState {
  const resolvedInput = seekToSeconds !== undefined ? seekToSeconds : inputAt(previous, atTime);
  const anchor: ScheduleAnchor = {
    output: atTime,
    outputTime: atTime,
    active,
    rate,
    ...(seekToSeconds !== undefined ? { input: seekToSeconds } : {}),
  };
  return { anchor, resolvedInput };
}

export function play(state: TransportState, atTime: number, rate: number): TransportState {
  return transition(state, atTime, true, rate);
}

export function pause(state: TransportState, atTime: number): TransportState {
  return transition(state, atTime, false, state.anchor.rate);
}

// Seeking while playing keeps playback active at the new position; seeking
// while paused stays paused there.
export function seek(state: TransportState, atTime: number, toSeconds: number): TransportState {
  return transition(state, atTime, state.anchor.active, state.anchor.rate, toSeconds);
}

export function setRate(state: TransportState, atTime: number, rate: number): TransportState {
  return transition(state, atTime, state.anchor.active, rate);
}
