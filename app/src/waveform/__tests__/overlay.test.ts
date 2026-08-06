import { describe, it, expect, vi } from 'vitest';
import { drawPlayhead } from '../overlay.ts';
import type { Canvas2DLike } from '../canvas.ts';

function fakeCtx(): Canvas2DLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clearRect: vi.fn((x, y, w, h) => calls.push(`clearRect:${x},${y},${w},${h}`)),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn((x, y) => calls.push(`moveTo:${x},${y}`)),
    lineTo: vi.fn((x, y) => calls.push(`lineTo:${x},${y}`)),
    stroke: vi.fn(() => calls.push('stroke')),
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
