import { describe, it, expect, vi } from 'vitest';
import { drawLoopLane } from '../lane.ts';
import { LOOP_REGION_FILL, LOOP_REGION_FILL_OFF } from '../colors.ts';
import type { Canvas2DLike } from '../canvas.ts';

// A setter on fillStyle records each assignment in call order, so a test
// can tell which fillRect used which colour rather than only seeing the
// final value.
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

describe('drawLoopLane', () => {
  // The canvas draws the region fill and nothing else — the A and B handles
  // are DOM elements over it, because each carries its own letter.
  it('clears first, then draws the region fill alone', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 100, endXPx: 300 }, 1200, 30, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,30',
      `fillStyle:${LOOP_REGION_FILL}`,
      'fillRect:100,0,200,30',
    ]);
  });

  it('draws only the clear when there is no region', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, null, 1200, 30, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,30']);
  });

  it('draws only the clear when the lane has no height', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 100, endXPx: 300 }, 1200, 0, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,0']);
  });

  it('clips the fill when the region runs off the left edge', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: -50, endXPx: 100 }, 1200, 30, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,30',
      `fillStyle:${LOOP_REGION_FILL}`,
      'fillRect:0,0,100,30',
    ]);
  });

  it('clips the fill when the region runs off the right edge', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 1100, endXPx: 1400 }, 1200, 30, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,30',
      `fillStyle:${LOOP_REGION_FILL}`,
      'fillRect:1100,0,100,30',
    ]);
  });

  it('draws no fill when the region is entirely outside the canvas', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: -200, endXPx: -50 }, 1200, 30, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,30']);
  });

  it('uses a dimmer fill when the loop is set but not repeating', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 100, endXPx: 300 }, 1200, 30, false);
    expect(ctx.calls).toContain(`fillStyle:${LOOP_REGION_FILL_OFF}`);
    expect(ctx.calls).not.toContain(`fillStyle:${LOOP_REGION_FILL}`);
  });
});
