/**
 * Whether offering a service-worker update is safe right now (spec §8).
 * Reloading kills Workers, so any active Separation must block the update
 * prompt entirely, not just warn about it.
 */

import type { Separation } from '../domain/types.ts';
import { isActive } from '../separation/queue.ts';

export function hasActiveSeparation(separations: Separation[]): boolean {
  return separations.some(isActive);
}
