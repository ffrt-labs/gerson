import { describe, it, expect } from 'vitest';
import { rulerTicks } from '../ruler.ts';

describe('rulerTicks', () => {
  it('places a tick every interval inside the viewport, at its own x', () => {
    const ticks = rulerTicks({ startSec: 0, durationSec: 200 }, 400, 50);
    expect(ticks).toEqual([
      { seconds: 0, xPx: 0 },
      { seconds: 50, xPx: 100 },
      { seconds: 100, xPx: 200 },
      { seconds: 150, xPx: 300 },
      { seconds: 200, xPx: 400 },
    ]);
  });

  // Zoomed in, the first tick is the first multiple *at or after* the
  // viewport start — never a negative one scrolled off the left edge.
  it('starts at the first multiple inside a scrolled viewport', () => {
    const ticks = rulerTicks({ startSec: 120, durationSec: 100 }, 200, 50);
    expect(ticks.map(t => t.seconds)).toEqual([150, 200]);
    expect(ticks[0].xPx).toBeCloseTo(60);
  });

  it('returns nothing for a degenerate viewport or width', () => {
    expect(rulerTicks({ startSec: 0, durationSec: 0 }, 400, 50)).toEqual([]);
    expect(rulerTicks({ startSec: 0, durationSec: 200 }, 0, 50)).toEqual([]);
    expect(rulerTicks({ startSec: 0, durationSec: 200 }, 400, 0)).toEqual([]);
  });

  // A NaN viewport (a poisoned clock reading upstream) must yield no ticks
  // rather than loop forever adding NaN to NaN.
  it('returns nothing for a non-finite viewport', () => {
    expect(rulerTicks({ startSec: NaN, durationSec: 200 }, 400, 50)).toEqual([]);
    expect(rulerTicks({ startSec: 0, durationSec: NaN }, 400, 50)).toEqual([]);
  });
});
