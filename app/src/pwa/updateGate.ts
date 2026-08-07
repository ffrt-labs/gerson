/**
 * Whether offering a service-worker update is safe right now (spec §8).
 * Reloading kills Workers, so a Separation that is running or queued —
 * including an interrupted one, which is still status 'queued' waiting for
 * Resume — must block the update prompt entirely, not just warn about it.
 */

import type { Separation } from '../domain/types.ts';

export function hasActiveSeparation(separations: Separation[]): boolean {
  return separations.some(s => s.status === 'running' || s.status === 'queued');
}
