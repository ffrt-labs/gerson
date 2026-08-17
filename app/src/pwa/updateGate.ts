/**
 * Whether offering a service-worker update is safe right now (spec §8).
 * Reloading kills Workers, so a Separation whose work a reload would destroy
 * blocks the update prompt entirely, not just warns about it.
 *
 * This asks a different question from queue.ts's isActive, and needs its own
 * predicate to ask it. `isActive` counts interrupted Separations — correct
 * for JobStatusBar.tsx, which asks "what should the user see?" and should
 * keep listing them. The gate asks "would reloading destroy work?", and an
 * interrupted Separation has no worker and holds no progress (its row is
 * written back at progress: 0), so reloading costs it exactly nothing.
 *
 * The answers coincided until interrupted rows became something a user can
 * leave parked indefinitely. Sharing the predicate now means one parked row
 * blocks app updates forever — the gate paying a real cost to protect
 * nothing, and the longer the row is ignored the further behind the fixes the
 * user falls, including the fix for the bug that created the row.
 */

import type { Separation } from '../domain/types.ts';
import { isActive } from '../separation/queue.ts';

export function hasActiveSeparation(separations: Separation[]): boolean {
  return separations.some(s => isActive(s) && !s.interrupted);
}
