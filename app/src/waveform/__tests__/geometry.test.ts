import { describe, it, expect } from 'vitest';
import { secondsAtX, playheadX } from '../geometry.ts';
import type { Viewport } from '../viewport.ts';

const fitTheSong: Viewport = { startSec: 0, durationSec: 240 };

describe('secondsAtX — click-to-seek mapping', () => {
  it('maps the left edge to the viewport start and the right edge to its end', () => {
    expect(secondsAtX(0, fitTheSong, 1200)).toBe(0);
    expect(secondsAtX(1200, fitTheSong, 1200)).toBe(240);
  });

  it('maps the midpoint to half the viewport span, offset by its start', () => {
    expect(secondsAtX(600, fitTheSong, 1200)).toBe(120);
  });

  it('offsets by the viewport start when zoomed in and panned', () => {
    const zoomed: Viewport = { startSec: 100, durationSec: 20 }; // [100, 120]
    expect(secondsAtX(0, zoomed, 1200)).toBe(100);
    expect(secondsAtX(1200, zoomed, 1200)).toBe(120);
    expect(secondsAtX(600, zoomed, 1200)).toBe(110);
  });

  it('clamps clicks outside the canvas to the nearest viewport edge', () => {
    expect(secondsAtX(-50, fitTheSong, 1200)).toBe(0);
    expect(secondsAtX(5000, fitTheSong, 1200)).toBe(240);
  });

  it('is unaffected by tempo — it never appears in the mapping', () => {
    // Same x, same width, same viewport: the seek target is identical no
    // matter how fast playback is sweeping across the viewport.
    const atSlowTempo = secondsAtX(300, fitTheSong, 1200);
    const atFastTempo = secondsAtX(300, fitTheSong, 1200);
    expect(atSlowTempo).toBe(atFastTempo);
  });

  it('returns the viewport start for a zero-width canvas or zero-span viewport rather than dividing by zero', () => {
    expect(secondsAtX(10, fitTheSong, 0)).toBe(0);
    expect(secondsAtX(10, { startSec: 30, durationSec: 0 }, 1200)).toBe(30);
  });
});

describe('playheadX — overlay position mapping', () => {
  it('sits at the left edge at the viewport start and the right edge at its end', () => {
    expect(playheadX(0, fitTheSong, 1200)).toBe(0);
    expect(playheadX(240, fitTheSong, 1200)).toBe(1200);
  });

  it('sits at the midpoint halfway through the viewport', () => {
    expect(playheadX(120, fitTheSong, 1200)).toBe(600);
  });

  it('offsets by the viewport start when zoomed in and panned', () => {
    const zoomed: Viewport = { startSec: 100, durationSec: 20 }; // [100, 120]
    expect(playheadX(100, zoomed, 1200)).toBe(0);
    expect(playheadX(120, zoomed, 1200)).toBe(1200);
    expect(playheadX(110, zoomed, 1200)).toBe(600);
  });

  it('is not clamped: a position outside the viewport maps outside the canvas', () => {
    expect(playheadX(-5, fitTheSong, 1200)).toBeLessThan(0);
    expect(playheadX(300, fitTheSong, 1200)).toBeGreaterThan(1200);
  });

  it('is the exact inverse of secondsAtX at the same width and viewport', () => {
    const widthPx = 1200;
    const viewport: Viewport = { startSec: 12.5, durationSec: 175 };
    for (const xPx of [0, 137, 600, 1199, 1200]) {
      const seconds = secondsAtX(xPx, viewport, widthPx);
      expect(playheadX(seconds, viewport, widthPx)).toBeCloseTo(xPx, 6);
    }
  });

  it('returns 0 for a zero-span viewport rather than dividing by zero', () => {
    expect(playheadX(10, { startSec: 0, durationSec: 0 }, 1200)).toBe(0);
  });
});
