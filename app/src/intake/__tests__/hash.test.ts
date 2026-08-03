import { describe, it, expect } from 'vitest';
import { hashBytes } from '../hash.js';

describe('hashBytes', () => {
  it('returns a 64-character hex string', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await hashBytes(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for the same bytes', async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const a = await hashBytes(bytes);
    const b = await hashBytes(new Uint8Array([10, 20, 30]));
    expect(a).toBe(b);
  });

  it('produces different hashes for different bytes', async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]));
    const b = await hashBytes(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it('accepts an ArrayBuffer as input', async () => {
    const buf = new Uint8Array([5, 6, 7]).buffer;
    const hash = await hashBytes(buf);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Uint8Array and its underlying ArrayBuffer produce the same hash', async () => {
    const bytes = new Uint8Array([99, 100, 101]);
    const fromUint8 = await hashBytes(bytes);
    const fromBuffer = await hashBytes(bytes.buffer);
    expect(fromUint8).toBe(fromBuffer);
  });

  it('empty bytes have a known SHA-256 hash', async () => {
    // SHA-256 of empty string is a well-known value
    const hash = await hashBytes(new Uint8Array(0));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
