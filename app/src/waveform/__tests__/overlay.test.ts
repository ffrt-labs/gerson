import { describe, it, expect, vi } from 'vitest';
import { drawPlayhead, drawLoopShading } from '../overlay.ts';
import type { Canvas2DLike } from '../canvas.ts';

function fakeCtx(): Canvas2DLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fillStyle: '',
    clearRect: vi.fn((x, y, w, h) => calls.push(`clearRect:${x},${y},${w},${h}`)),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn((x, y) => calls.push(`moveTo:${x},${y}`)),
    lineTo: vi.fn((x, y) => calls.push(`lineTo:${x},${y}`)),
    stroke: vi.fn(() => calls.push('stroke')),
    fillRect: vi.fn((x, y, w, h) => calls.push(`fillRect:${x},${y},${w},${h}`)),
  };
}

describe('drawPlayhead', () => {
  it('clears the full overlay, then draws one vertical line at the given x, full height', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 300, 1200, 256);

    expect(ctx.calls).toEqual([
      'clearRect:0,0,1200,256',
      'beginPath',
      'moveTo:300.5,0',
      'lineTo:300.5,256',
      'stroke',
    ]);
  });

  it('draws only the clear when the overlay has no height', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 10, 1200, 0);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,0']);
  });

  it('places the line at the left edge for position 0 and the right edge at the song end', () => {
    const ctx = fakeCtx();
    drawPlayhead(ctx, 0, 1200, 256);
    expect(ctx.calls).toContain('moveTo:0.5,0');

    const ctx2 = fakeCtx();
    drawPlayhead(ctx2, 1200, 1200, 256);
    expect(ctx2.calls).toContain('moveTo:1200.5,0');
  });
});

describe('drawLoopShading', () => {
  it('fills exactly the region span, never clearing (drawPlayhead owns the clear)', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, 100, 300, 1200, 256, true);
    expect(ctx.calls).toEqual(['fillRect:100,0,200,256']);
  });

  it('handles a reversed start/end the same as an ordered one', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, 300, 100, 1200, 256, true);
    expect(ctx.calls).toEqual(['fillRect:100,0,200,256']);
  });

  it('clips to the canvas when the region runs off the left edge', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, -50, 100, 1200, 256, true);
    expect(ctx.calls).toEqual(['fillRect:0,0,100,256']);
  });

  it('clips to the canvas when the region runs off the right edge', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, 1100, 1400, 1200, 256, true);
    expect(ctx.calls).toEqual(['fillRect:1100,0,100,256']);
  });

  it('draws nothing when the region is entirely outside the canvas', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, -100, -10, 1200, 256, true);
    expect(ctx.calls).toEqual([]);
  });

  it('draws nothing when the overlay has no height', () => {
    const ctx = fakeCtx();
    drawLoopShading(ctx, 100, 300, 1200, 0, true);
    expect(ctx.calls).toEqual([]);
  });

  it('uses a dimmer fill when the loop is disabled', () => {
    const enabledCtx = fakeCtx();
    drawLoopShading(enabledCtx, 100, 300, 1200, 256, true);
    const enabledFill = enabledCtx.fillStyle;

    const disabledCtx = fakeCtx();
    drawLoopShading(disabledCtx, 100, 300, 1200, 256, false);
    const disabledFill = disabledCtx.fillStyle;

    expect(disabledFill).not.toBe(enabledFill);
  });
});
