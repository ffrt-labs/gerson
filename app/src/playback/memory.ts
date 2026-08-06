/**
 * Playback memory policy (spec §4.5). Cost is exactly computable from a
 * Song's duration before any stem is decoded — the device budget is not
 * (`navigator.deviceMemory` is absent in Safari, `performance.memory` is
 * Chrome-only) — so policy runs on the half we know exactly.
 */

import { ROLES } from '../domain/types.ts';

const BYTES_PER_SAMPLE = 4; // Float32Array — the format stems are decoded into (§4.4)

// Desktop budget (§4.5): a 25-minute track still plays in stereo, so in
// practice this never fires — which is the intent.
export const DESKTOP_MEMORY_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

/** Resident playback bytes for all four stems of a Song, before decoding a byte. */
export function playbackMemoryBytes(durationSec: number, sampleRate: number, mono: boolean): number {
  const channelsPerStem = mono ? 1 : 2;
  return ROLES.length * channelsPerStem * BYTES_PER_SAMPLE * sampleRate * durationSec;
}

export function exceedsBudget(bytes: number): boolean {
  return bytes > DESKTOP_MEMORY_BUDGET_BYTES;
}
