import { describe, it, expect } from 'vitest';
import { mixPeaks } from '../mix.ts';
import type { Role } from '../../domain/types.ts';

// Stored peaks are [Lmin, Lmax, Rmin, Rmax] per source column.
function peaks(...values: number[]): Int8Array {
  return new Int8Array(values);
}

function set(over: Partial<Record<Role, Int8Array>>): Record<Role, Int8Array> {
  const empty = peaks(0, 0, 0, 0);
  return { vocals: empty, drums: empty, bass: empty, other: empty, ...over };
}

describe('mixPeaks', () => {
  it('takes the extreme of the four stems in every channel slot', () => {
    const mixed = mixPeaks(set({
      vocals: peaks(-10, 20, -5, 15),
      drums: peaks(-40, 8, -60, 90),
    }));
    expect(Array.from(mixed)).toEqual([-40, 20, -60, 90]);
  });

  it('returns an empty array when no stem has any peaks', () => {
    expect(mixPeaks(set({})).length).toBe(4);
    const roles = { vocals: peaks(), drums: peaks(), bass: peaks(), other: peaks() };
    expect(mixPeaks(roles).length).toBe(0);
  });

  // Stems of one Song are the same length, but a repaired or truncated
  // peaks file must not silently drop the longer stems' tail — the mix
  // spans the longest, and a stem that has ended contributes silence.
  it('spans the longest stem, treating a short stem as silence past its end', () => {
    const mixed = mixPeaks(set({
      vocals: peaks(-10, 10, -10, 10),
      drums: peaks(-20, 20, -20, 20, -30, 30, -30, 30),
    }));
    expect(Array.from(mixed)).toEqual([-20, 20, -20, 20, -30, 30, -30, 30]);
  });

  it('does not mutate the stems it reads', () => {
    const vocals = peaks(-10, 20, -5, 15);
    mixPeaks(set({ vocals }));
    expect(Array.from(vocals)).toEqual([-10, 20, -5, 15]);
  });
});
