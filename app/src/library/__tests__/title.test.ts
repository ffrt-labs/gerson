import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '../title.ts';

describe('normalizeTitle', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTitle('  My Song  ')).toBe('My Song');
  });

  it('returns null for an empty string', () => {
    expect(normalizeTitle('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(normalizeTitle('   ')).toBeNull();
  });

  it('leaves internal whitespace untouched', () => {
    expect(normalizeTitle('  My   Song  ')).toBe('My   Song');
  });
});
