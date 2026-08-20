/**
 * Pure loop-region math for the dedicated lane and its numeric readouts
 * (§5.4): drag interpretation (create/resize/move), clamping against the
 * song's duration, and set-from-playhead. No DOM, no canvas — LoopLane and
 * Player call these and hand the result straight to Transport.setLoop /
 * PracticeState. Nothing here snaps to anything, per spec — every value
 * that comes in (a pixel position converted to seconds, a playhead
 * position, a typed number) passes through unchanged except for the
 * boundary clamps below.
 */

import { clamp } from './clamp.ts';
import type { LoopRegion } from '../domain/types.ts';

// A region shorter than this can't be grabbed back apart at any zoom
// level's edge tolerance, and a zero-length loop breaks the modulo wrap in
// anchor.ts — so every mutator here refuses to produce one.
export const MIN_LOOP_LENGTH_SEC = 0.05;

// The finest deliberate adjustment to a loop edge: one arrow-key press, one
// stepper press in the precision drawer. Fine enough to place an edge
// precisely by ear without a beat grid (Gerson has no notion of beats);
// coarser than this would stop being a nudge and start being a typo.
export const LOOP_STEP_SEC = 0.01;

export type LoopDragMode = 'create' | 'resize-start' | 'resize-end' | 'move';

// Which gesture a mousedown in the lane starts, given where it landed
// relative to the existing region's edges (§5.4: "its edges drag there;
// dragging its middle moves it without resizing").
export function hitTestLoopLane(downSec: number, loop: LoopRegion | null, edgeToleranceSec: number): LoopDragMode {
  if (loop) {
    if (Math.abs(downSec - loop.startSec) <= edgeToleranceSec) return 'resize-start';
    if (Math.abs(downSec - loop.endSec) <= edgeToleranceSec) return 'resize-end';
    if (downSec > loop.startSec && downSec < loop.endSec) return 'move';
  }
  return 'create';
}

// A fresh drag always spans the low-to-high of the two points touched,
// regardless of which direction the pointer moved.
export function dragToRegion(anchorSec: number, currentSec: number): LoopRegion {
  return anchorSec <= currentSec
    ? { startSec: anchorSec, endSec: currentSec }
    : { startSec: currentSec, endSec: anchorSec };
}

export function resizeStart(region: LoopRegion, nextStartSec: number): LoopRegion {
  const startSec = clamp(nextStartSec, 0, region.endSec - MIN_LOOP_LENGTH_SEC);
  return { startSec, endSec: region.endSec };
}

export function resizeEnd(region: LoopRegion, nextEndSec: number, durationSec: number): LoopRegion {
  const endSec = clamp(nextEndSec, region.startSec + MIN_LOOP_LENGTH_SEC, Math.max(0, durationSec));
  return { startSec: region.startSec, endSec };
}

// Keeps the region's length exactly fixed while sliding both edges
// together — resizeStart/resizeEnd would each independently clamp and
// could shrink the region against a song boundary instead of just sliding
// it back.
export function moveRegion(region: LoopRegion, deltaSec: number, durationSec: number): LoopRegion {
  const length = region.endSec - region.startSec;
  const maxStart = Math.max(0, durationSec - length);
  const startSec = clamp(region.startSec + deltaSec, 0, maxStart);
  return { startSec, endSec: startSec + length };
}

// Re-derives a valid region once the song's bounds are known (e.g. on
// load, or after a fresh drag that isn't clamped yet) — pulls both edges
// inside [0, durationSec] and restores the minimum length if clamping
// collapsed it.
export function clampRegionToDuration(region: LoopRegion, durationSec: number): LoopRegion {
  const songDuration = Math.max(0, durationSec);
  let startSec = clamp(region.startSec, 0, songDuration);
  let endSec = clamp(region.endSec, 0, songDuration);
  if (endSec - startSec < MIN_LOOP_LENGTH_SEC) {
    endSec = Math.min(songDuration, startSec + MIN_LOOP_LENGTH_SEC);
    startSec = Math.max(0, endSec - MIN_LOOP_LENGTH_SEC);
  }
  return { startSec, endSec };
}

// The length readout is edited/nudged by moving the end edge, start held
// fixed — the same convention as a DAW's loop-length field.
export function setLength(region: LoopRegion, lengthSec: number, durationSec: number): LoopRegion {
  return resizeEnd(region, region.startSec + lengthSec, durationSec);
}

// Set-loop-start/end from the playhead (§5.4's load-bearing precision
// path — "place an edge by ear rather than by eye"). With no region yet,
// the first press seeds one running to the nearest song boundary so it's
// immediately a valid loop; the second press narrows the free edge.
export function setStartFromPlayhead(loop: LoopRegion | null, positionSec: number, durationSec: number): LoopRegion {
  if (!loop) return clampRegionToDuration({ startSec: positionSec, endSec: durationSec }, durationSec);
  return resizeStart(loop, positionSec);
}

export function setEndFromPlayhead(loop: LoopRegion | null, positionSec: number, durationSec: number): LoopRegion {
  if (!loop) return clampRegionToDuration({ startSec: 0, endSec: positionSec }, durationSec);
  return resizeEnd(loop, positionSec, durationSec);
}
