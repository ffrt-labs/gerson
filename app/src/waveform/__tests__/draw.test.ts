import { describe, it, expect, vi } from 'vitest';
import { drawWaveform } from '../draw.ts';
import type { Canvas2DLike } from '../canvas.ts';
import type { PeakColumn } from '../pixels.ts';

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

describe('drawWaveform', () => {
  it('clears exactly the canvas rect before drawing', () => {
    const ctx = fakeCtx();
    drawWaveform(ctx, [{ min: -10, max: 10 }], 1, 64);
    expect(ctx.calls[0]).toBe('clearRect:0,0,1,64');
  });

  it('draws one moveTo/lineTo pair per column, centered vertically, in a single path', () => {
    const ctx = fakeCtx();
    const columns: PeakColumn[] = [
      { min: -127, max: 127 }, // full-height column
      { min: 0, max: 0 }, // silent column
    ];
    drawWaveform(ctx, columns, 2, 100);

    expect(ctx.calls).toEqual([
      'clearRect:0,0,2,100',
      'beginPath',
      'moveTo:0.5,0', // max=127 -> top edge
      'lineTo:0.5,100', // min=-127 -> bottom edge
      'moveTo:1.5,50', // silent column sits exactly on center
      'lineTo:1.5,50',
      'stroke',
    ]);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1); // one path, one stroke — not one per column
  });

  it('maps a positive (max) sample above center and a negative (min) sample below it', () => {
    const ctx = fakeCtx();
    drawWaveform(ctx, [{ min: -63.5, max: 63.5 }], 1, 100);
    // max half-scale -> quarter of the way up from center (25); min mirrors it down (75).
    expect(ctx.calls).toContain('moveTo:0.5,25');
    expect(ctx.calls).toContain('lineTo:0.5,75');
  });

  it('draws nothing but the clear for an empty column list', () => {
    const ctx = fakeCtx();
    drawWaveform(ctx, [], 0, 64);
    expect(ctx.calls).toEqual(['clearRect:0,0,0,64']);
  });
});
