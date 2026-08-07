/**
 * Small-quota detection (spec §7.2): Chrome's "clear cookies and site data
 * when you close all windows" setting caps the origin quota at roughly
 * 300 MB (research/03) — room for about 1.6 songs of stems. That is a
 * browser setting, not a full disk, so it is detected once at startup and
 * reported as one, distinct from the ordinary "not enough free space"
 * pre-flight in intake/space.ts.
 */

import { STEMS_SIZE_BYTES, type EstimateFn } from '../intake/space.ts';

// Comfortably above the ~300 MB "clear on exit" cap and far below any
// ordinary desktop quota (tens to hundreds of GB), so this never fires for
// a browser that merely has a full disk.
export const SMALL_QUOTA_THRESHOLD_BYTES = 5 * STEMS_SIZE_BYTES;

export interface QuotaCheckResult {
  small: boolean;
  persistDenied: boolean;
}

type PersistedFn = () => Promise<boolean>;

export async function checkQuota(
  estimate: EstimateFn = () => navigator.storage.estimate(),
  persisted: PersistedFn = () => navigator.storage.persisted(),
): Promise<QuotaCheckResult> {
  const { quota = 0 } = await estimate();
  if (!(quota > 0 && quota < SMALL_QUOTA_THRESHOLD_BYTES)) {
    return { small: false, persistDenied: false };
  }
  // Only asked when it matters: a persist() refusal folds into the
  // small-quota conversation rather than becoming a notice of its own.
  const isPersisted = await persisted();
  return { small: true, persistDenied: !isPersisted };
}
