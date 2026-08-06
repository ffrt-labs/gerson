import { describe, it, expect } from 'vitest';
import { playbackMemoryBytes, exceedsBudget, DESKTOP_MEMORY_BUDGET_BYTES } from '../memory.ts';

const SAMPLE_RATE = 44100;

describe('playbackMemoryBytes', () => {
  it('computes stereo cost as 4 stems × 2 channels × 4 bytes × sampleRate × duration', () => {
    const durationSec = 60;
    const expected = 4 * 2 * 4 * SAMPLE_RATE * durationSec;
    expect(playbackMemoryBytes(durationSec, SAMPLE_RATE, false)).toBe(expected);
  });

  it('mono is exactly half of stereo for the same duration', () => {
    const durationSec = 231;
    const stereo = playbackMemoryBytes(durationSec, SAMPLE_RATE, false);
    const mono = playbackMemoryBytes(durationSec, SAMPLE_RATE, true);
    expect(mono).toBe(stereo / 2);
  });

  it('scales linearly with duration', () => {
    const oneMinute = playbackMemoryBytes(60, SAMPLE_RATE, false);
    const fourMinutes = playbackMemoryBytes(240, SAMPLE_RATE, false);
    expect(fourMinutes).toBe(oneMinute * 4);
  });

});

describe('exceedsBudget', () => {
  it('is false at exactly the budget', () => {
    expect(exceedsBudget(DESKTOP_MEMORY_BUDGET_BYTES)).toBe(false);
  });

  it('is false comfortably under the 2 GB budget — a 25-minute track in stereo', () => {
    const bytes = playbackMemoryBytes(25 * 60, SAMPLE_RATE, false);
    expect(exceedsBudget(bytes)).toBe(false);
  });

  it('is true just over the budget', () => {
    expect(exceedsBudget(DESKTOP_MEMORY_BUDGET_BYTES + 1)).toBe(true);
  });
});
