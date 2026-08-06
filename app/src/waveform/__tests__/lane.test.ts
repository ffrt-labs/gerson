import { describe, it, expect, vi } from 'vitest';
import { drawLoopLane } from '../lane.ts';
import type { Canvas2DLike } from '../canvas.ts';

// fillStyle is a plain property on the real CanvasRenderingContext2D, but
// drawLoopLane sets it twice (fill color, then handle color) — a setter
// here records both assignments in call order, so a test can tell which
// fillRect used which color rather than only seeing the final value.
function fakeCtx(): Canvas2DLike & { calls: string[] } {
  const calls: string[] = [];
  let fillStyleValue = '';
  return {
    calls,
    get fillStyle() {
      return fillStyleValue;
    },
    set fillStyle(value: string) {
      fillStyleValue = value;
      calls.push(`fillStyle:${value}`);
    },
    clearRect: vi.fn((x, y, w, h) => calls.push(`clearRect:${x},${y},${w},${h}`)),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn((x, y) => calls.push(`moveTo:${x},${y}`)),
    lineTo: vi.fn((x, y) => calls.push(`lineTo:${x},${y}`)),
    stroke: vi.fn(() => calls.push('stroke')),
    fillRect: vi.fn((x, y, w, h) => calls.push(`fillRect:${x},${y},${w},${h}`)),
  };
}

describe('drawLoopLane', () => {
  it('always clears first, then draws the fill and both edge handles', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 100, endXPx: 300 }, 1200, 20, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,20',
      'fillStyle:rgba(217, 164, 65, 0.45)',
      'fillRect:100,0,200,20',
      'fillStyle:#d9a441',
      'fillRect:99,0,2,20',
      'fillRect:299,0,2,20',
    ]);
  });

  it('draws only the clear when there is no region', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, null, 1200, 20, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,20']);
  });

  it('draws only the clear when the lane has no height', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 100, endXPx: 300 }, 1200, 0, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,0']);
  });

  it('clips the fill and drops the off-screen handle when the region runs off the left edge', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: -50, endXPx: 100 }, 1200, 20, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,20',
      'fillStyle:rgba(217, 164, 65, 0.45)',
      'fillRect:0,0,100,20',
      'fillStyle:#d9a441',
      'fillRect:99,0,2,20', // only the visible (end) handle
    ]);
  });

  it('clips the fill and drops the off-screen handle when the region runs off the right edge', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: 1100, endXPx: 1400 }, 1200, 20, true);
    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,20',
      'fillStyle:rgba(217, 164, 65, 0.45)',
      'fillRect:1100,0,100,20',
      'fillStyle:#d9a441',
      'fillRect:1099,0,2,20', // only the visible (start) handle
    ]);
  });

  it('draws no fill or handles when the region is entirely outside the canvas', () => {
    const ctx = fakeCtx();
    drawLoopLane(ctx, { startXPx: -200, endXPx: -50 }, 1200, 20, true);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,20']);
  });

  it('uses a dimmer fill color for the region when the loop is disabled (the handle color stays the same)', () => {
    const enabledCtx = fakeCtx();
    drawLoopLane(enabledCtx, { startXPx: 100, endXPx: 300 }, 1200, 20, true);

    const disabledCtx = fakeCtx();
    drawLoopLane(disabledCtx, { startXPx: 100, endXPx: 300 }, 1200, 20, false);

    const enabledFillColor = enabledCtx.calls[1];
    const disabledFillColor = disabledCtx.calls[1];
    expect(disabledFillColor).not.toBe(enabledFillColor);
  });
});
