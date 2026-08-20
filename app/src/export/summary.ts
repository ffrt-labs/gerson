/**
 * The chips on the export sheet's Mix card: exactly what the rendered file
 * will have baked into it. This is the part the old UI left the user to
 * guess — "Export mix" honoured gain, mute, solo and the loop with nothing
 * on screen saying so.
 *
 * Gain is deliberately not listed: every Song has four gain values at all
 * times, so a chip per Stem would be four chips that never go away and say
 * nothing. Mute, solo and loop are states the user turned *on*.
 */

import { ROLES, type PracticeState, type Role } from '../domain/types.ts';
import { formatLengthSec } from '../format/units.ts';

export interface MixSummaryChip {
  readonly kind: 'mute' | 'solo' | 'loop';
  readonly label: string;
}

export function mixSummaryChips(
  practice: PracticeState,
  solo: Record<Role, boolean>,
): MixSummaryChip[] {
  const chips: MixSummaryChip[] = [];

  for (const role of ROLES) {
    if (practice.stems[role].muted) chips.push({ kind: 'mute', label: `${role.toUpperCase()} MUTED` });
  }
  for (const role of ROLES) {
    if (solo[role]) chips.push({ kind: 'solo', label: `${role.toUpperCase()} SOLO` });
  }

  // A region that is set but toggled off does not repeat, so it changes
  // nothing about the rendered file — claiming it would misdescribe it.
  if (practice.loop && practice.loopEnabled) {
    chips.push({
      kind: 'loop',
      label: `LOOP ${formatLengthSec(practice.loop.endSec - practice.loop.startSec)}`,
    });
  }

  return chips;
}
