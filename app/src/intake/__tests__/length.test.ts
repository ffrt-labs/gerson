import { describe, it, expect } from 'vitest';
import { MAX_RECORDING_SEC, exceedsLengthCap, tooLongMessage } from '../length.ts';

describe('MAX_RECORDING_SEC', () => {
  it('is a round 7 minutes, not the fitted break point', () => {
    expect(MAX_RECORDING_SEC).toBe(420);
  });
});

describe('exceedsLengthCap', () => {
  it('accepts a Recording exactly at the cap', () => {
    expect(exceedsLengthCap(MAX_RECORDING_SEC)).toBe(false);
  });

  it('accepts a Recording under the cap', () => {
    expect(exceedsLengthCap(4 * 60)).toBe(false);
  });

  it('refuses a Recording past the cap', () => {
    expect(exceedsLengthCap(MAX_RECORDING_SEC + 1)).toBe(true);
    expect(exceedsLengthCap(8 * 60 + 42)).toBe(true);
  });
});

describe('tooLongMessage', () => {
  it("names the file's own length, the way nospace names needsBytes", () => {
    expect(tooLongMessage(8 * 60 + 42)).toContain('8m 42s');
  });

  it('states the rule in minutes, never as the fitted 7:25 break point', () => {
    const msg = tooLongMessage(8 * 60 + 42);
    expect(msg).toContain('7 minutes');
    expect(msg).not.toMatch(/25 seconds|7:25/);
  });

  it('gives the reason, so a flat refusal does not read as arbitrary', () => {
    expect(tooLongMessage(500).toLowerCase()).toMatch(/memory/);
  });

  it('does not offer a workaround it cannot honour', () => {
    expect(tooLongMessage(500).toLowerCase()).not.toMatch(/try again|retry/);
  });
});
