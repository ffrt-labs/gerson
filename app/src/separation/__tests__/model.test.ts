import { describe, it, expect } from 'vitest';
import { verifyModelBytes } from '../model.ts';

const EXPECTED = 'a'.repeat(64);

describe('verifyModelBytes', () => {
  it('passes when length matches Content-Length and the hash matches', () => {
    const result = verifyModelBytes(100, 100, EXPECTED, EXPECTED);
    expect(result.ok).toBe(true);
  });

  it('passes when Content-Length is unavailable but the hash matches', () => {
    const result = verifyModelBytes(100, null, EXPECTED, EXPECTED);
    expect(result.ok).toBe(true);
  });

  it('fails as truncated when byte length is short of Content-Length', () => {
    const result = verifyModelBytes(50, 100, EXPECTED, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('truncated');
  });

  it('fails as truncated before ever checking the hash', () => {
    // Even a matching hash of the (short) bytes must not pass — length is
    // checked first, and a truncated file must never become the model.
    const result = verifyModelBytes(50, 100, EXPECTED, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('truncated');
  });

  it('fails as hash-mismatch when length matches but the digest does not', () => {
    const result = verifyModelBytes(100, 100, 'b'.repeat(64), EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('hash-mismatch');
  });

  it('fails as hash-mismatch when Content-Length is unavailable and the digest is wrong', () => {
    const result = verifyModelBytes(100, null, 'b'.repeat(64), EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('hash-mismatch');
  });

  it('defaults the expected hash to the build-pinned MODEL_SHA256', async () => {
    const { MODEL_SHA256 } = await import('../../../../wasm/dist/model-sha256.ts');
    const result = verifyModelBytes(10, 10, MODEL_SHA256);
    expect(result.ok).toBe(true);
  });
});
