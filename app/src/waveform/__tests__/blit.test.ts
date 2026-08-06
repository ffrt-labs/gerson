import { describe, it, expect, vi } from 'vitest';
import { blitViewportShift, type Canvas2DBlitLike } from '../blit.ts';
import type { Viewport } from '../viewport.ts';

function fakeCtx(): Canvas2DBlitLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clearRect: vi.fn((x, y, w, h) => calls.push(`clearRect:${x},${y},${w},${h}`)),
    drawImage: vi.fn((_image, sx, sy, sw, sh, dx, dy, dw, dh) =>
      calls.push(`drawImage:${sx},${sy},${sw},${sh},${dx},${dy},${dw},${dh}`),
    ),
  };
}

const FAKE_SOURCE = {} as CanvasImageSource;

describe('blitViewportShift', () => {
  it('clears then draws an identity blit (unchanged viewport) as a straight copy', () => {
    const ctx = fakeCtx();
    const viewport: Viewport = { startSec: 10, durationSec: 20 };
    blitViewportShift(ctx, FAKE_SOURCE, viewport, viewport, 1200, 256);

    expect(ctx.calls).toEqual(['clearRect:0,0,1200,256', 'drawImage:0,0,1200,256,0,0,1200,256']);
  });

  it('translates the source rect right when the viewport pans forward (later start, same span)', () => {
    const ctx = fakeCtx();
    const from: Viewport = { startSec: 0, durationSec: 20 }; // [0,20]
    const to: Viewport = { startSec: 5, durationSec: 20 }; // [5,25], shifted a quarter-span later
    blitViewportShift(ctx, FAKE_SOURCE, from, to, 1200, 256);

    // sx = (5-0)/20 * 1200 = 300; sw = (20/20)*1200 = 1200 (full width, still translated).
    expect(ctx.calls).toContain('drawImage:300,0,1200,256,0,0,1200,256');
  });

  it('translates the source rect left when the viewport pans backward', () => {
    const ctx = fakeCtx();
    const from: Viewport = { startSec: 10, durationSec: 20 };
    const to: Viewport = { startSec: 5, durationSec: 20 };
    blitViewportShift(ctx, FAKE_SOURCE, from, to, 1200, 256);

    // sx = (5-10)/20 * 1200 = -300.
    expect(ctx.calls).toContain('drawImage:-300,0,1200,256,0,0,1200,256');
  });

  it('shrinks the source rect when zooming in (smaller new span)', () => {
    const ctx = fakeCtx();
    const from: Viewport = { startSec: 0, durationSec: 40 };
    const to: Viewport = { startSec: 10, durationSec: 20 }; // half the span, offset a quarter in
    blitViewportShift(ctx, FAKE_SOURCE, from, to, 1200, 256);

    // scale = 40/20 = 2 -> sw = 1200*2? No: scale = from/to = 2, sw = widthPx*scale = 2400.
    // sx = (10-0)/40 * 1200 = 300.
    expect(ctx.calls).toContain('drawImage:300,0,2400,256,0,0,1200,256');
  });

  it('grows the source rect when zooming out (larger new span)', () => {
    const ctx = fakeCtx();
    const from: Viewport = { startSec: 10, durationSec: 20 };
    const to: Viewport = { startSec: 0, durationSec: 40 };
    blitViewportShift(ctx, FAKE_SOURCE, from, to, 1200, 256);

    // scale = 20/40 = 0.5 -> sw = 600; sx = (0-10)/20*1200 = -600.
    expect(ctx.calls).toContain('drawImage:-600,0,600,256,0,0,1200,256');
  });

  it('always clears the full destination rect before drawing, even for a no-op shift', () => {
    const ctx = fakeCtx();
    const viewport: Viewport = { startSec: 0, durationSec: 20 };
    blitViewportShift(ctx, FAKE_SOURCE, viewport, viewport, 800, 64);
    expect(ctx.calls[0]).toBe('clearRect:0,0,800,64');
  });

  it('clears but skips drawImage when the previous viewport had no span (nothing to blit from)', () => {
    const ctx = fakeCtx();
    const from: Viewport = { startSec: 0, durationSec: 0 };
    const to: Viewport = { startSec: 0, durationSec: 20 };
    blitViewportShift(ctx, FAKE_SOURCE, from, to, 1200, 256);
    expect(ctx.calls).toEqual(['clearRect:0,0,1200,256']);
  });

  it('clears but skips drawImage for a zero-size canvas', () => {
    const ctx = fakeCtx();
    const viewport: Viewport = { startSec: 0, durationSec: 20 };
    blitViewportShift(ctx, FAKE_SOURCE, viewport, viewport, 0, 256);
    expect(ctx.calls).toEqual(['clearRect:0,0,0,256']);
  });
});
