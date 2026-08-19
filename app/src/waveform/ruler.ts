/**
 * The time ruler under the Stage waveform: which times fall inside the
 * current viewport, and where each sits in CSS pixels. Pure viewport
 * arithmetic, like geometry.ts — the band that renders these owns its own
 * type and colour, this owns only the positions.
 */

import { playheadX } from './geometry.ts';
import type { Viewport } from './viewport.ts';

export interface RulerTick {
  readonly seconds: number;
  readonly xPx: number;
}

export function rulerTicks(viewport: Viewport, widthPx: number, intervalSec: number): RulerTick[] {
  // Guarding non-finite inputs first is load-bearing, not defensive: with a
  // NaN start, `first` is NaN and `sec += intervalSec` never exceeds the
  // loop bound, so the loop below would never terminate.
  if (!Number.isFinite(viewport.startSec) || !Number.isFinite(viewport.durationSec)) return [];
  if (widthPx <= 0 || viewport.durationSec <= 0 || intervalSec <= 0) return [];

  const endSec = viewport.startSec + viewport.durationSec;
  const first = Math.ceil(viewport.startSec / intervalSec) * intervalSec;

  const ticks: RulerTick[] = [];
  for (let sec = first; sec <= endSec; sec += intervalSec) {
    ticks.push({ seconds: sec, xPx: playheadX(sec, viewport, widthPx) });
  }
  return ticks;
}
