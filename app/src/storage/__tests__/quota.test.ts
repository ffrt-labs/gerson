import { describe, it, expect, vi } from 'vitest';
import { checkQuota, SMALL_QUOTA_THRESHOLD_BYTES } from '../quota.ts';

function makeEstimate(quota: number) {
  return async (): Promise<StorageEstimate> => ({ quota, usage: 0 });
}

describe('checkQuota', () => {
  it('reports not small for an ordinary desktop quota', async () => {
    const persisted = vi.fn(async () => true);
    const result = await checkQuota(makeEstimate(500 * 1024 * 1024 * 1024), persisted);

    expect(result.small).toBe(false);
    expect(result.persistDenied).toBe(false);
    // Only matters when small — never asked otherwise.
    expect(persisted).not.toHaveBeenCalled();
  });

  it("detects Chrome's ~300 MB clear-on-close cap as small", async () => {
    const persisted = vi.fn(async () => true);
    const result = await checkQuota(makeEstimate(300 * 1024 * 1024), persisted);

    expect(result.small).toBe(true);
  });

  it('treats a zero/unknown quota as not small rather than a false positive', async () => {
    const persisted = vi.fn(async () => true);
    const result = await checkQuota(makeEstimate(0), persisted);

    expect(result.small).toBe(false);
  });

  it('folds a persist() refusal into the small-quota result rather than reporting it standalone', async () => {
    const persisted = vi.fn(async () => false);
    const result = await checkQuota(makeEstimate(SMALL_QUOTA_THRESHOLD_BYTES - 1), persisted);

    expect(result.small).toBe(true);
    expect(result.persistDenied).toBe(true);
  });

  it('reports persistDenied false when persistence was granted', async () => {
    const persisted = vi.fn(async () => true);
    const result = await checkQuota(makeEstimate(SMALL_QUOTA_THRESHOLD_BYTES - 1), persisted);

    expect(result.persistDenied).toBe(false);
  });

  it('is not small right at and above the threshold', async () => {
    const persisted = vi.fn(async () => true);
    const result = await checkQuota(makeEstimate(SMALL_QUOTA_THRESHOLD_BYTES), persisted);

    expect(result.small).toBe(false);
  });
});
