import { describe, it, expect } from 'vitest';
import {
  initialTransportState,
  inputAt,
  play,
  pause,
  seek,
  setRate,
  setLoop,
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

describe('loop wrap — disabled by default', () => {
  it('never wraps when loopStart equals loopEnd (the initial 0,0 state)', () => {
    const state = play(initialTransportState, 0, 1);
    expect(inputAt(state, 1000)).toBe(1000);
  });
});

describe('setLoop', () => {
  it('carries output/outputTime identically (footgun 1) and sends no input field (footgun 2)', () => {
    const played = play(initialTransportState, 0, 1);
    const looped = setLoop(played, 5, 10, 14);
    expect(looped.anchor.output).toBe(looped.anchor.outputTime);
    expect(looped.anchor.input).toBeUndefined();
  });

  it('does not itself move the playhead — only future wrap behaviour changes', () => {
    const played = play(initialTransportState, 0, 1);
    const before = inputAt(played, 5);
    const looped = setLoop(played, 5, 100, 200); // well outside current position
    expect(inputAt(looped, 5)).toBe(before);
  });

  it('a position before loopEnd is unaffected', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    expect(inputAt(state, 15)).toBe(15); // 15 < loopEnd(20)
  });

  it('wraps to loopStart the instant position reaches loopEnd', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    expect(inputAt(state, 20)).toBe(10);
    expect(inputAt(state, 22)).toBe(12);
  });

  it('wraps repeatedly across many loop iterations, not just the first', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20); // 10s loop length
    // 20 + 10*10.5 = 125 -> 105 seconds past loopStart's original entry;
    // past = 125 - 20 = 105; 105 % 10 = 5 -> wraps to loopStart + 5 = 15.
    expect(inputAt(state, 125)).toBeCloseTo(15, 10);
  });

  it('handles a non-integer loop length cleanly, including a non-integer boundary', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10.25, 17.75); // 7.5s length
    // past = 30 - 17.75 = 12.25; 12.25 % 7.5 = 4.75 -> 10.25 + 4.75 = 15
    expect(inputAt(state, 30)).toBeCloseTo(15, 10);
  });

  it('is carried forward across a subsequent play/pause/seek/setRate, not reset to disabled', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    state = setRate(state, 1, 2);
    state = pause(state, 2);
    state = play(state, 3, 1);
    expect(state.anchor.loopStart).toBe(10);
    expect(state.anchor.loopEnd).toBe(20);
    expect(inputAt(state, 100)).toBe(10); // still wrapping: raw 100 -> past 80 -> 80%10=0 -> loopStart+0
  });

  it('a seek while looping resolves through the wrap immediately', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    state = seek(state, 5, 25); // seek target itself is past loopEnd
    expect(inputAt(state, 5)).toBe(15); // 25 wraps to loopStart(10) + (25-20)=5 -> 15
  });

  it('disabling the loop (equal start/end) stops future wrapping from wherever position sits', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    state = setLoop(state, 25, 0, 0); // disable at t=25 — position was wrapped to 15
    expect(inputAt(state, 25)).toBe(15);
    expect(inputAt(state, 35)).toBe(25); // grows linearly, no more wrap
  });

  it('applies the same wrap to a frozen (paused) position', () => {
    let state = play(initialTransportState, 0, 1);
    state = setLoop(state, 0, 10, 20);
    state = pause(state, 24); // frozen resolvedInput lands past loopEnd pre-wrap
    expect(inputAt(state, 24)).toBe(14);
    expect(inputAt(state, 999)).toBe(14); // stays frozen, still wrapped
  });

  // §4.6/06's acceptance bar: wrap stays clean across several positions and
  // rates, including non-integer boundaries — not just the rate-1, round-
  // number cases above.
  it.each([
    { rate: 2, loopStart: 5, loopEnd: 8, atTime: 6, expected: 6 }, // one wrap, integer bounds
    { rate: 0.5, loopStart: 12.5, loopEnd: 16.25, atTime: 40, expected: 12.5 }, // non-integer boundary, lands exactly on loopStart
    { rate: 1.75, loopStart: 2.2, loopEnd: 9.7, atTime: 10, expected: 2.5 }, // non-integer boundary, mid-loop
    { rate: 3, loopStart: 0, loopEnd: 2, atTime: 7, expected: 1 }, // several iterations at a fast rate
  ])('rate $rate, loop [$loopStart, $loopEnd]: wraps to $expected at t=$atTime', ({ rate, loopStart, loopEnd, atTime, expected }) => {
    let state = play(initialTransportState, 0, rate);
    state = setLoop(state, 0, loopStart, loopEnd);
    expect(inputAt(state, atTime)).toBeCloseTo(expected, 9);
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
