import { describe, it, expect } from 'vitest';
import {
  minVisibleDurationSec,
  fitTheSongViewport,
  clampViewport,
  zoomViewport,
  panViewport,
  isPositionVisible,
  followViewport,
  followIfNeeded,
  type Viewport,
} from '../viewport.ts';

describe('minVisibleDurationSec — the 1-pair/px zoom floor', () => {
  it('is 256 samples worth of time per physical pixel at 44100 Hz (5.8ms/px)', () => {
    expect(minVisibleDurationSec(1, 44100)).toBeCloseTo(256 / 44100, 9);
  });

  it('scales linearly with width', () => {
    expect(minVisibleDurationSec(1200, 44100)).toBeCloseTo((1200 * 256) / 44100, 6);
  });

  it('returns 0 for a non-positive width or sample rate rather than dividing by zero', () => {
    expect(minVisibleDurationSec(0, 44100)).toBe(0);
    expect(minVisibleDurationSec(1200, 0)).toBe(0);
  });
});

describe('fitTheSongViewport', () => {
  it('spans the whole song starting at 0', () => {
    expect(fitTheSongViewport(240)).toEqual({ startSec: 0, durationSec: 240 });
  });

  it('never produces a negative duration for a bogus negative song length', () => {
    expect(fitTheSongViewport(-5)).toEqual({ startSec: 0, durationSec: 0 });
  });
});

describe('clampViewport', () => {
  it('leaves an already-valid viewport untouched', () => {
    const v: Viewport = { startSec: 10, durationSec: 20 };
    expect(clampViewport(v, 240, 1)).toEqual(v);
  });

  it('clamps duration to at least minDurationSec (over-zoomed-in)', () => {
    expect(clampViewport({ startSec: 0, durationSec: 0.1 }, 240, 5)).toEqual({ startSec: 0, durationSec: 5 });
  });

  it('clamps duration to at most the song length (over-zoomed-out)', () => {
    expect(clampViewport({ startSec: 0, durationSec: 1000 }, 240, 1)).toEqual({ startSec: 0, durationSec: 240 });
  });

  it('pulls a negative start back to 0', () => {
    expect(clampViewport({ startSec: -50, durationSec: 20 }, 240, 1)).toEqual({ startSec: 0, durationSec: 20 });
  });

  it('pulls a start past the reachable end back so start+duration fits the song', () => {
    expect(clampViewport({ startSec: 235, durationSec: 20 }, 240, 1)).toEqual({ startSec: 220, durationSec: 20 });
  });

  it('forces startSec to 0 once duration is clamped to the full song', () => {
    expect(clampViewport({ startSec: 100, durationSec: 1000 }, 240, 1)).toEqual({ startSec: 0, durationSec: 240 });
  });
});

describe('zoomViewport', () => {
  it('halves the duration when zooming in by factor 2, keeping the focus point fixed', () => {
    const v: Viewport = { startSec: 100, durationSec: 40 }; // spans [100, 140]
    // Focus at 110 (fraction 0.25 into the viewport).
    const next = zoomViewport(v, 2, 110, 1000, 1);
    expect(next.durationSec).toBeCloseTo(20, 9);
    // 110 should still sit at fraction 0.25 of the new (20s) span: start = 110 - 0.25*20 = 105.
    expect(next.startSec).toBeCloseTo(105, 9);
  });

  it('doubles the duration when zooming out by factor 0.5, keeping the focus point fixed', () => {
    const v: Viewport = { startSec: 100, durationSec: 20 }; // spans [100, 120]
    const next = zoomViewport(v, 0.5, 120, 1000, 1); // focus at the right edge
    expect(next.durationSec).toBeCloseTo(40, 9);
    expect(next.startSec).toBeCloseTo(80, 9); // right edge (120) held fixed
  });

  it('clamps the result at the 1-pair/px floor', () => {
    const v: Viewport = { startSec: 0, durationSec: 10 };
    const next = zoomViewport(v, 1000, 5, 1000, 2);
    expect(next.durationSec).toBe(2);
  });

  it('clamps the result at fit-the-song when zooming out past it', () => {
    const v: Viewport = { startSec: 100, durationSec: 40 };
    const next = zoomViewport(v, 0.001, 120, 240, 1);
    expect(next).toEqual({ startSec: 0, durationSec: 240 });
  });

  it('is a no-op for a non-positive factor', () => {
    const v: Viewport = { startSec: 10, durationSec: 20 };
    expect(zoomViewport(v, 0, 15, 240, 1)).toEqual(v);
    expect(zoomViewport(v, -3, 15, 240, 1)).toEqual(v);
  });
});

describe('panViewport', () => {
  it('shifts the start by deltaSec, keeping duration fixed', () => {
    const v: Viewport = { startSec: 50, durationSec: 20 };
    expect(panViewport(v, 5, 240, 1)).toEqual({ startSec: 55, durationSec: 20 });
    expect(panViewport(v, -5, 240, 1)).toEqual({ startSec: 45, durationSec: 20 });
  });

  it('clamps at the left edge of the song', () => {
    const v: Viewport = { startSec: 5, durationSec: 20 };
    expect(panViewport(v, -100, 240, 1)).toEqual({ startSec: 0, durationSec: 20 });
  });

  it('clamps at the right edge of the song', () => {
    const v: Viewport = { startSec: 200, durationSec: 20 };
    expect(panViewport(v, 100, 240, 1)).toEqual({ startSec: 220, durationSec: 20 });
  });
});

describe('isPositionVisible', () => {
  const v: Viewport = { startSec: 10, durationSec: 20 }; // [10, 30]

  it('is true strictly inside the viewport', () => {
    expect(isPositionVisible(15, v)).toBe(true);
  });

  it('is true exactly on either edge', () => {
    expect(isPositionVisible(10, v)).toBe(true);
    expect(isPositionVisible(30, v)).toBe(true);
  });

  it('is false outside either edge', () => {
    expect(isPositionVisible(9.99, v)).toBe(false);
    expect(isPositionVisible(30.01, v)).toBe(false);
  });
});

describe('followViewport', () => {
  it('re-anchors the viewport so the playhead sits at its start edge, keeping duration fixed', () => {
    const v: Viewport = { startSec: 0, durationSec: 20 };
    expect(followViewport(v, 50, 240, 1)).toEqual({ startSec: 50, durationSec: 20 });
  });

  it('clamps the re-anchored viewport to the song bounds', () => {
    const v: Viewport = { startSec: 0, durationSec: 20 };
    expect(followViewport(v, 235, 240, 1)).toEqual({ startSec: 220, durationSec: 20 });
  });

  it('handles a backward jump (e.g. a loop wrap) the same way as a forward one', () => {
    const v: Viewport = { startSec: 100, durationSec: 20 };
    expect(followViewport(v, 5, 240, 1)).toEqual({ startSec: 5, durationSec: 20 });
  });
});

describe('clampViewport — reference identity', () => {
  it('returns the same object when clamping changes nothing, so React can bail out', () => {
    const v: Viewport = { startSec: 10, durationSec: 20 };
    expect(clampViewport(v, 240, 1)).toBe(v);
  });

  it('returns a new object when it actually clamps', () => {
    const v: Viewport = { startSec: 500, durationSec: 20 };
    expect(clampViewport(v, 240, 1)).not.toBe(v);
  });
});

describe('followIfNeeded — the auto-follow decision', () => {
  const song = 240;
  const min = 1;

  it('returns null when the playhead is already visible', () => {
    expect(followIfNeeded({ startSec: 0, durationSec: 20 }, 5, song, min)).toBe(null);
  });

  it('follows when the playhead has left the viewport', () => {
    expect(followIfNeeded({ startSec: 0, durationSec: 20 }, 50, song, min)).toEqual({
      startSec: 50,
      durationSec: 20,
    });
  });

  // #87: during the first output-latency window after Play, the playhead is
  // legitimately negative — and clampViewport floors startSec at 0, so no
  // viewport can ever contain it. Following anyway produced a fresh-but-equal
  // viewport on every render, which is what crashed the Player route.
  it('returns null for a negative playhead, which no viewport can reach', () => {
    expect(followIfNeeded({ startSec: 0, durationSec: song }, -0.058, song, min)).toBe(null);
  });

  it('returns null for a playhead past the end of the song', () => {
    expect(followIfNeeded({ startSec: 220, durationSec: 20 }, 300, song, min)).toBe(null);
  });

  // The termination guarantee, stated directly: WaveformStage applies this
  // during render, so a second call that did NOT return null would re-render
  // forever. Every hostile input the component can actually be handed.
  describe('is idempotent — a second call with the same inputs returns null', () => {
    const cases: Array<[string, Viewport, number, number, number]> = [
      ['negative playhead (#87)', { startSec: 0, durationSec: song }, -0.058, song, min],
      ['playhead past the song end', { startSec: 0, durationSec: 20 }, 300, song, min],
      ['NaN playhead', { startSec: 0, durationSec: 20 }, NaN, song, min],
      ['Infinite playhead', { startSec: 0, durationSec: 20 }, Infinity, song, min],
      ['-Infinite playhead', { startSec: 0, durationSec: 20 }, -Infinity, song, min],
      ['NaN song duration', { startSec: 0, durationSec: 20 }, 5, NaN, min],
      ['NaN min duration (NaN sample rate)', { startSec: 0, durationSec: 20 }, 5, song, NaN],
      ['NaN viewport', { startSec: NaN, durationSec: NaN }, 5, song, min],
      ['zero-duration song', { startSec: 0, durationSec: 0 }, 5, 0, 0],
      ['zero-width container (min 0)', { startSec: 0, durationSec: song }, 300, song, 0],
      ['min duration wider than the song', { startSec: 0, durationSec: 20 }, 300, 10, 60],
      ['ordinary forward jump', { startSec: 0, durationSec: 20 }, 50, song, min],
      ['ordinary backward jump', { startSec: 100, durationSec: 20 }, 5, song, min],
    ];

    it.each(cases)('%s', (_name, viewport, position, songDurationSec, minDurationSec) => {
      const first = followIfNeeded(viewport, position, songDurationSec, minDurationSec);
      if (first === null) return;
      expect(followIfNeeded(first, position, songDurationSec, minDurationSec)).toBe(null);
    });
  });
});
