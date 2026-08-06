import { describe, it, expect } from 'vitest';
import { secondsAtX, playheadX } from '../geometry.ts';

describe('secondsAtX — click-to-seek mapping', () => {
  it('maps the left edge to 0 and the right edge to the full duration', () => {
    expect(secondsAtX(0, 240, 1200)).toBe(0);
    expect(secondsAtX(1200, 240, 1200)).toBe(240);
  });

  it('maps the midpoint to half the duration', () => {
    expect(secondsAtX(600, 240, 1200)).toBe(120);
  });

  it('clamps clicks outside the canvas to the nearest edge', () => {
    expect(secondsAtX(-50, 240, 1200)).toBe(0);
    expect(secondsAtX(5000, 240, 1200)).toBe(240);
  });

  it('is unaffected by tempo — it never appears in the mapping', () => {
    // Same x, same width, same duration: the seek target is identical no
    // matter how fast playback is sweeping across the viewport.
    const atSlowTempo = secondsAtX(300, 240, 1200);
    const atFastTempo = secondsAtX(300, 240, 1200);
    expect(atSlowTempo).toBe(atFastTempo);
  });

  it('returns 0 for a zero-width or zero-duration viewport rather than dividing by zero', () => {
    expect(secondsAtX(10, 240, 0)).toBe(0);
    expect(secondsAtX(10, 0, 1200)).toBe(0);
  });
});

describe('playheadX — overlay position mapping', () => {
  it('sits at the left edge at position 0 and the right edge at the song end', () => {
    expect(playheadX(0, 240, 1200)).toBe(0);
    expect(playheadX(240, 240, 1200)).toBe(1200);
  });

  it('sits at the midpoint halfway through the song', () => {
    expect(playheadX(120, 240, 1200)).toBe(600);
  });

  it('clamps a position outside the song to the nearest edge', () => {
    expect(playheadX(-5, 240, 1200)).toBe(0);
    expect(playheadX(300, 240, 1200)).toBe(1200);
  });

  it('is the exact inverse of secondsAtX at the same width and duration', () => {
    const widthPx = 1200;
    const durationSec = 187.5;
    for (const xPx of [0, 137, 600, 1199, 1200]) {
      const seconds = secondsAtX(xPx, durationSec, widthPx);
      expect(playheadX(seconds, durationSec, widthPx)).toBeCloseTo(xPx, 6);
    }
  });

  it('returns 0 for a zero-duration song rather than dividing by zero', () => {
    expect(playheadX(10, 0, 1200)).toBe(0);
  });
});
