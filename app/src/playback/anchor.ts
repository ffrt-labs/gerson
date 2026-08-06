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
 *
 * Loop wrap (§4.6, §5.4) piggybacks on the same anchor: `loopStart`/
 * `loopEnd` travel on every transition exactly like `rate` does (carried
 * forward unless the transition is the one changing it), because
 * signalsmith-stretch's own `schedule()` disables looping only when both are
 * equal — there is no "omit to disable". `inputAt` applies the identical
 * wrap the worklet applies internally, so the main-thread playhead and the
 * audio never disagree about where a loop wraps.
 */

export interface ScheduleAnchor {
  readonly output: number;
  readonly outputTime: number;
  readonly active: boolean;
  readonly rate: number;
  readonly input?: number;
  readonly loopStart: number;
  readonly loopEnd: number;
}

export interface TransportState {
  readonly anchor: ScheduleAnchor;
  // The absolute input-buffer position implied at anchor.output. Tracked
  // separately from anchor.input because the anchor only carries `input`
  // when the transition was a seek (footgun 2) — this is always known.
  readonly resolvedInput: number;
}

export const initialTransportState: TransportState = {
  anchor: { output: 0, outputTime: 0, active: false, rate: 1, loopStart: 0, loopEnd: 0 },
  resolvedInput: 0,
};

// Mirrors the worklet's own loop wrap (§4.6): once position reaches
// loopEnd, it re-enters at loopStart and continues — the modulo handles any
// number of loop iterations, not just the first, so a long-running loop
// still resolves correctly. Disabled (no wrap) whenever loopStart and
// loopEnd are equal, matching signalsmith-stretch's own disable rule.
function wrapToLoop(position: number, loopStart: number, loopEnd: number): number {
  const loopLength = loopEnd - loopStart;
  if (loopLength <= 0 || position < loopEnd) return position;
  const past = position - loopEnd;
  return loopStart + (past % loopLength);
}

// The input-buffer position implied by a state at a given AudioContext time
// — recomputed from the anchor, not accumulated, so it stays exact across
// any number of prior rate changes.
export function inputAt(state: TransportState, atTime: number): number {
  const { anchor, resolvedInput } = state;
  const raw = anchor.active ? resolvedInput + (atTime - anchor.output) * anchor.rate : resolvedInput;
  return wrapToLoop(raw, anchor.loopStart, anchor.loopEnd);
}

function transition(
  previous: TransportState,
  atTime: number,
  active: boolean,
  rate: number,
  loopStart: number,
  loopEnd: number,
  seekToSeconds?: number,
): TransportState {
  const resolvedInput = seekToSeconds !== undefined ? seekToSeconds : inputAt(previous, atTime);
  const anchor: ScheduleAnchor = {
    output: atTime,
    outputTime: atTime,
    active,
    rate,
    loopStart,
    loopEnd,
    ...(seekToSeconds !== undefined ? { input: seekToSeconds } : {}),
  };
  return { anchor, resolvedInput };
}

export function play(state: TransportState, atTime: number, rate: number): TransportState {
  return transition(state, atTime, true, rate, state.anchor.loopStart, state.anchor.loopEnd);
}

export function pause(state: TransportState, atTime: number): TransportState {
  return transition(state, atTime, false, state.anchor.rate, state.anchor.loopStart, state.anchor.loopEnd);
}

// Seeking while playing keeps playback active at the new position; seeking
// while paused stays paused there.
export function seek(state: TransportState, atTime: number, toSeconds: number): TransportState {
  return transition(state, atTime, state.anchor.active, state.anchor.rate, state.anchor.loopStart, state.anchor.loopEnd, toSeconds);
}

export function setRate(state: TransportState, atTime: number, rate: number): TransportState {
  return transition(state, atTime, state.anchor.active, rate, state.anchor.loopStart, state.anchor.loopEnd);
}

// loopStart === loopEnd disables looping (signalsmith-stretch's own rule) —
// callers wanting "no loop" pass equal values (e.g. 0, 0) rather than
// omitting the fields, since schedule() has no separate "unset" state.
export function setLoop(state: TransportState, atTime: number, loopStart: number, loopEnd: number): TransportState {
  return transition(state, atTime, state.anchor.active, state.anchor.rate, loopStart, loopEnd);
}
