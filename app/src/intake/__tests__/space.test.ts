import { describe, it, expect } from 'vitest';
import { checkSpace, STEMS_SIZE_BYTES } from '../space.js';

const ONE_MB = 1024 * 1024;

function makeEstimate(quota: number, usage: number) {
  return async (): Promise<StorageEstimate> => ({ quota, usage });
}

describe('checkSpace', () => {
  it('returns ok when quota minus usage exceeds stems + recording', async () => {
    const recordingBytes = 10 * ONE_MB;
    const needed = STEMS_SIZE_BYTES + recordingBytes;
    const estimate = makeEstimate(needed + 1, 0);
    const result = await checkSpace(recordingBytes, estimate);
    expect(result.ok).toBe(true);
  });

  it('returns not ok when available space is less than needed', async () => {
    const recordingBytes = 10 * ONE_MB;
    const needed = STEMS_SIZE_BYTES + recordingBytes;
    const estimate = makeEstimate(needed - 1, 0);
    const result = await checkSpace(recordingBytes, estimate);
    expect(result.ok).toBe(false);
  });

  it('accounts for existing usage when computing available space', async () => {
    const recordingBytes = 5 * ONE_MB;
    const needed = STEMS_SIZE_BYTES + recordingBytes;
    // quota = needed + 50 MB, usage = 51 MB → only 49 MB free, not enough
    const quota = needed + 50 * ONE_MB;
    const usage = 51 * ONE_MB;
    const estimate = makeEstimate(quota, usage);
    const result = await checkSpace(recordingBytes, estimate);
    expect(result.ok).toBe(false);
  });

  it('reports the total bytes needed in both ok and nospace cases', async () => {
    const recordingBytes = 20 * ONE_MB;
    const needed = STEMS_SIZE_BYTES + recordingBytes;

    const okResult = await checkSpace(recordingBytes, makeEstimate(needed * 2, 0));
    expect(okResult.needsBytes).toBe(needed);

    const failResult = await checkSpace(recordingBytes, makeEstimate(1, 0));
    expect(failResult.needsBytes).toBe(needed);
  });

  it('treats missing quota/usage as zero', async () => {
    const recordingBytes = 1 * ONE_MB;
    const estimate = async (): Promise<StorageEstimate> => ({});
    const result = await checkSpace(recordingBytes, estimate);
    expect(result.ok).toBe(false);
  });
});
