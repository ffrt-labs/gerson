import { describe, it, expect } from 'vitest';
import { mixSummaryChips } from '../summary.ts';
import { defaultPracticeState, type PracticeState, type Role } from '../../domain/types.ts';

const NO_SOLO: Record<Role, boolean> = { vocals: false, drums: false, bass: false, other: false };

function practiceWith(patch: Partial<PracticeState>): PracticeState {
  return { ...defaultPracticeState(), ...patch };
}

describe('mixSummaryChips', () => {
  // The point of the Mix card: show exactly what will be baked in, rather
  // than leaving the user to guess.
  it('is empty when nothing is engaged', () => {
    expect(mixSummaryChips(defaultPracticeState(), NO_SOLO)).toEqual([]);
  });

  it('names each muted Stem', () => {
    const practice = practiceWith({
      stems: { ...defaultPracticeState().stems, vocals: { gain: 1, muted: true } },
    });
    expect(mixSummaryChips(practice, NO_SOLO)).toEqual([{ kind: 'mute', label: 'VOCALS MUTED' }]);
  });

  it('names each soloed Stem', () => {
    expect(mixSummaryChips(defaultPracticeState(), { ...NO_SOLO, bass: true })).toEqual([
      { kind: 'solo', label: 'BASS SOLO' },
    ]);
  });

  // The loop only bakes in when it is actually repeating — a region left
  // set but toggled off changes nothing about the render, so claiming it
  // would misdescribe the file.
  it('reports the loop only when the region is set and enabled', () => {
    const loop = { startSec: 78.4, endSec: 96.2 };
    expect(mixSummaryChips(practiceWith({ loop, loopEnabled: true }), NO_SOLO)).toEqual([
      { kind: 'loop', label: 'LOOP 17.80s' },
    ]);
    expect(mixSummaryChips(practiceWith({ loop, loopEnabled: false }), NO_SOLO)).toEqual([]);
    expect(mixSummaryChips(practiceWith({ loop: null, loopEnabled: true }), NO_SOLO)).toEqual([]);
  });

  it('lists mutes, then solos, then the loop', () => {
    const practice = practiceWith({
      loop: { startSec: 0, endSec: 4 },
      loopEnabled: true,
      stems: { ...defaultPracticeState().stems, drums: { gain: 1, muted: true } },
    });
    expect(mixSummaryChips(practice, { ...NO_SOLO, bass: true }).map(c => c.label)).toEqual([
      'DRUMS MUTED',
      'BASS SOLO',
      'LOOP 4.00s',
    ]);
  });
});
