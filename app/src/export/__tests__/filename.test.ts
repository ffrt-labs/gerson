import { describe, it, expect } from 'vitest';
import { sanitizeForFilename, stemFilename, mixFilename } from '../filename.ts';

describe('sanitizeForFilename', () => {
  it('leaves an already-safe title untouched', () => {
    expect(sanitizeForFilename('My Song')).toBe('My Song');
  });

  it('strips characters illegal on common filesystems', () => {
    expect(sanitizeForFilename('AC/DC: Back In Black?')).toBe('AC DC Back In Black');
  });

  it('trims the result', () => {
    expect(sanitizeForFilename('  Padded  ')).toBe('Padded');
  });
});

describe('stemFilename', () => {
  it('builds "<title> - <role>.<ext>"', () => {
    expect(stemFilename('My Song', 'vocals', 'flac')).toBe('My Song - vocals.flac');
  });

  it('sanitizes the title component', () => {
    expect(stemFilename('A/B', 'drums', 'wav')).toBe('A B - drums.wav');
  });
});

describe('mixFilename', () => {
  it('builds "<title> - mix.<ext>"', () => {
    expect(mixFilename('My Song', 'flac')).toBe('My Song - mix.flac');
  });

  it('sanitizes the title component', () => {
    expect(mixFilename('A/B', 'wav')).toBe('A B - mix.wav');
  });
});
