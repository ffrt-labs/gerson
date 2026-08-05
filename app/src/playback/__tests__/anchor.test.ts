import { describe, it, expect } from 'vitest';
import {
  initialTransportState,
  inputAt,
  play,
  pause,
  seek,
  setRate,
  type TransportState,
} from '../anchor.ts';

describe('footgun 1 — output and outputTime always identical', () => {
  it('holds for play, pause, seek, and setRate', () => {
    let state = play(initialTransportState, 0, 1);
    expect(state.anchor.output).toBe(state.anchor.outputTime);

    state = setRate(state, 5, 0.5);
    expect(state.anchor.output).toBe(state.anchor.outputTime);

    state = seek(state, 8, 20);
    expect(state.anchor.output).toBe(state.anchor.outputTime);

    state = pause(state, 12);
    expect(state.anchor.output).toBe(state.anchor.outputTime);
  });
});

describe('footgun 2 — input present only on seek', () => {
  it('is omitted from play, pause, and setRate anchors', () => {
    const played = play(initialTransportState, 0, 1);
    expect(played.anchor.input).toBeUndefined();

    const rated = setRate(played, 3, 1.5);
    expect(rated.anchor.input).toBeUndefined();

    const paused = pause(rated, 6);
    expect(paused.anchor.input).toBeUndefined();
  });

  it('is present only on seek, and equals the seek target exactly', () => {
    const played = play(initialTransportState, 0, 1);
    const sought = seek(played, 4, 17.25);
    expect(sought.anchor.input).toBe(17.25);
  });

  it('a rate change does not move the playhead', () => {
    const played = play(initialTransportState, 0, 1);
    const before = inputAt(played, 5);

    const rated = setRate(played, 5, 2);
    const after = inputAt(rated, 5);

    expect(after).toBe(before);
  });
});

describe('position is recomputed from the anchor, not accumulated over time', () => {
  it('a long run within one segment is a single closed-form evaluation, not a loop', () => {
    // A 7-minute song at 0.5x — if position were accumulated per-quantum in
    // JS (rather than left to the library's own per-quantum recompute off
    // this anchor), this is the kind of duration that would surface drift.
    const state = play(initialTransportState, 0, 0.5);
    expect(inputAt(state, 420)).toBe(420 * 0.5);
  });

  it('each rate change re-anchors exactly at the switch point, however many precede it', () => {
    let state = play(initialTransportState, 0, 1);
    for (let i = 0; i < 50; i++) {
      state = setRate(state, i * 0.1, 1 + (i % 3) * 0.25);
    }
    // Continuity, not drift: the position implied at the instant of the last
    // change matches what a fresh evaluation of that final anchor gives.
    const t = 4.9;
    expect(inputAt(state, t)).toBe(state.resolvedInput);
  });

  it('seeking replaces the base position outright, discarding all prior history', () => {
    let state = play(initialTransportState, 0, 1);
    for (let i = 0; i < 50; i++) {
      state = setRate(state, i * 0.1, 1 + (i % 3) * 0.25);
    }
    state = seek(state, 5, 42);
    expect(inputAt(state, 5)).toBe(42);
    expect(inputAt(state, 5.1)).toBeCloseTo(42 + 0.1 * state.anchor.rate, 12);
  });
});

describe('pause and resume', () => {
  it('freezes position while paused', () => {
    const played = play(initialTransportState, 0, 2);
    const paused = pause(played, 3);
    expect(inputAt(paused, 3)).toBe(6);
    expect(inputAt(paused, 10)).toBe(6); // no motion while inactive
  });

  it('resuming continues from the frozen position', () => {
    const played = play(initialTransportState, 0, 2);
    const paused = pause(played, 3);
    const resumed = play(paused, 8, 1);
    expect(inputAt(resumed, 8)).toBe(6);
    expect(inputAt(resumed, 9)).toBe(7);
  });
});

describe('sync — identical state transitions never diverge across independent lanes', () => {
  it('four lanes fed the same operation sequence stay bit-identical throughout', () => {
    const ops: Array<(s: TransportState, t: number) => TransportState> = [
      (s, t) => play(s, t, 1),
      (s, t) => setRate(s, t, 0.5),
      (s, t) => setRate(s, t, 1.8),
      (s, t) => seek(s, t, 30),
      (s, t) => setRate(s, t, 1.25),
      (s, t) => pause(s, t),
      (s, t) => play(s, t, 0.75),
    ];

    let lanes: TransportState[] = [
      initialTransportState,
      initialTransportState,
      initialTransportState,
      initialTransportState,
    ];

    let t = 0;
    for (const op of ops) {
      t += 1.618;
      lanes = lanes.map(lane => op(lane, t));

      const sampleTimes = [t, t + 0.01, t + 2.5];
      for (const sampleTime of sampleTimes) {
        const positions = lanes.map(lane => inputAt(lane, sampleTime));
        const maxDelta = Math.max(...positions) - Math.min(...positions);
        expect(maxDelta).toBe(0);
      }
    }
  });
});
