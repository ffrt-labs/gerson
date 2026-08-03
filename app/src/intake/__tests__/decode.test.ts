import { describe, it, expect } from 'vitest';
import { browserName, DecodeError } from '../decode.js';

describe('browserName', () => {
  it('identifies Firefox', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
    expect(browserName(ua)).toBe('Firefox');
  });

  it('identifies Edge (Edg/ token)', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';
    expect(browserName(ua)).toBe('Edge');
  });

  it('identifies Chrome (before Safari check)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    expect(browserName(ua)).toBe('Chrome');
  });

  it('identifies Safari (no Chrome token)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(browserName(ua)).toBe('Safari');
  });

  it('falls back to "Your browser" for unknown UA', () => {
    expect(browserName('SomeUnknownUA/1.0')).toBe('Your browser');
  });
});

describe('DecodeError message format', () => {
  it('names the browser in the message', () => {
    const err = new DecodeError('Firefox');
    expect(err.message).toContain('Firefox');
    expect(err.message).toContain("WAV or FLAC");
  });

  it('is an instance of Error', () => {
    expect(new DecodeError('Chrome')).toBeInstanceOf(Error);
  });
});
