import { describe, it, expect, vi } from 'vitest';
import { clearOverlay, drawPlayhead, drawLoopFocus } from '../overlay.ts';
import { WAVE_SOLO, LOOP_REGION_WASH, OUTSIDE_LOOP_SCRIM } from '../colors.ts';
import type { Canvas2DLike } from '../canvas.ts';

// fillStyle is set several times per draw, so a setter records each
// assignment in call order — a test can then tell which fill used which
// colour, not just see the last one to land.
function fakeCtx(): Canvas2DLike & { calls: string[] } {
  const calls: string[] = [];
  let fillStyleValue: Canvas2DLike['fillStyle'] = '';
  return {
    calls,
    get fillStyle() {
      return fillStyleValue;
    },
    set fillStyle(value: Canvas2DLike['fillStyle']) {
      fillStyleValue = value;
      calls.push(`fillStyle:${String(value)}`);
    },
    clearRect: vi.fn((x, y, w, h) => calls.push(`clearRect:${x},${y},${w},${h}`)),
    beginPath: vi.fn(() => calls.push('beginPath')),
    closePath: vi.fn(() => calls.push('closePath')),
    moveTo: vi.fn((x, y) => calls.push(`moveTo:${x},${y}`)),
    lineTo: vi.fn((x, y) => calls.push(`lineTo:${x},${y}`)),
    stroke: vi.fn(() => calls.push('stroke')),
    fill: vi.fn(() => calls.push('fill')),
    fillRect: vi.fn((x, y, w, h) => calls.push(`fillRect:${x},${y},${w},${h}`)),
  };
}

describe('clearOverlay', () => {
  // The clear is its own step so the caller controls paint order: the loop
  // focus goes down first and the playhead on top of it. When the clear was
  // folded into drawPlayhead, anything composited before it was wiped.
  it('clears the whole canvas', () => {
    const ctx = fakeCtx();
    clearOverlay(ctx, 1200, 316);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,316']);
  });
});

describe('drawPlayhead', () => {
  it('draws a 2px lime line at the given x plus a triangular cap at the top', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 300, 1200, 316, 2, 7);

    expect(ctx.calls).toEqual([
      `fillStyle:${WAVE_SOLO}`,
      'fillRect:299,0,2,316',
      'beginPath',
      'moveTo:293,0',
      'lineTo:307,0',
      'lineTo:300,7',
      'closePath',
      'fill',
    ]);
  });

  it('never clears — the caller owns that, so the loop focus survives', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 300, 1200, 316, 2, 7);
    expect(ctx.calls.some(c => c.startsWith('clearRect'))).toBe(false);
  });

  it('draws nothing when the overlay has no height', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 10, 1200, 0, 2, 7);
    expect(ctx.calls).toEqual([]);
  });

  // A playhead outside the viewport maps outside the canvas, and simply
  // does not appear — never pinned to an edge it is not at.
  it('draws nothing when the playhead is off either edge', () => {
    const left = fakeCtx();
    drawPlayhead(left, -20, 1200, 316, 2, 7);
    expect(left.calls).toEqual([]);

    const right = fakeCtx();
    drawPlayhead(right, 1400, 1200, 316, 2, 7);
    expect(right.calls).toEqual([]);
  });
});

describe('drawLoopFocus', () => {
  // The 'both' mode from the handoff, and the intended default: the region
  // gets an amber wash, and everything outside it is scrimmed back so the
  // loop reads as the focus.
  it('scrims both sides of the region and washes the region itself', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, 400, 700, 1200, 316, true);

    expect(ctx.calls).toEqual([
      `fillStyle:${OUTSIDE_LOOP_SCRIM}`,
      'fillRect:0,0,400,316',
      'fillRect:700,0,500,316',
      `fillStyle:${LOOP_REGION_WASH}`,
      'fillRect:400,0,300,316',
    ]);
  });

  it('handles a reversed start/end the same as an ordered one', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, 700, 400, 1200, 316, true);
    expect(ctx.calls).toContain('fillRect:400,0,300,316');
  });

  it('omits the scrim on a side the region runs off', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, -50, 700, 1200, 316, true);
    expect(ctx.calls).toEqual([
      `fillStyle:${OUTSIDE_LOOP_SCRIM}`,
      'fillRect:700,0,500,316',
      `fillStyle:${LOOP_REGION_WASH}`,
      'fillRect:0,0,700,316',
    ]);
  });

  it('draws nothing when the region is entirely outside the canvas', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, -100, -10, 1200, 316, true);
    expect(ctx.calls).toEqual([]);
  });

  it('draws nothing when the overlay has no height', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, 100, 300, 1200, 0, true);
    expect(ctx.calls).toEqual([]);
  });

  // Toggling the loop off must not look like losing the region.
  it('uses a dimmer wash and no scrim when the loop is not repeating', () => {
    const ctx = fakeCtx();
    drawLoopFocus(ctx, 400, 700, 1200, 316, false);

    expect(ctx.calls.some(c => c === `fillStyle:${OUTSIDE_LOOP_SCRIM}`)).toBe(false);
    expect(ctx.calls).toContain('fillRect:400,0,300,316');
    expect(ctx.fillStyle).not.toBe(LOOP_REGION_WASH);
  });
});
