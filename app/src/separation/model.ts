/**
 * The model lifecycle (spec §7.3, §8): a three-valued app state —
 * absent | downloading | ready — read by the separation entry point
 * (intake/enqueue.ts) before a Separation is ever created. The 80 MB of
 * weights are fetched on first separation, with consent, never eagerly.
 *
 * Verification happens before the download is ever visible under the name
 * modelReady() checks for, so a truncated or tampered download can never
 * pass for a real model — see storage/opfs.ts's temp/commit split.
 */

import { MODEL_SHA256 } from '../../../wasm/dist/model-sha256.ts';
import { modelReady, writeModelTemp, commitModelTemp, deleteModelTemp } from '../storage/opfs.ts';

export type ModelState = 'absent' | 'downloading' | 'ready';

export const MODEL_URL = '/model/ggml-model-htdemucs-4s-f16.bin';

export type ModelDownloadFailureReason = 'truncated' | 'hash-mismatch' | 'network' | 'storage';

export type ModelDownloadResult =
  | { ok: true }
  | { ok: false; reason: ModelDownloadFailureReason; message: string };

export type ModelDownloadProgress = (receivedBytes: number, totalBytes: number | null) => void;

// Pure: decides whether downloaded bytes are the real model before anything
// is promoted to the name the separation worker trusts. Length first — it's
// free — then the hash, since a truncated download is the common case and
// the SHA-256 is the expensive check.
export function verifyModelBytes(
  byteLength: number,
  contentLength: number | null,
  actualSha256Hex: string,
  expectedSha256Hex: string = MODEL_SHA256,
): ModelDownloadResult {
  if (contentLength !== null && byteLength !== contentLength) {
    return {
      ok: false,
      reason: 'truncated',
      message: `Downloaded ${byteLength} of ${contentLength} bytes — the connection was interrupted.`,
    };
  }
  if (actualSha256Hex !== expectedSha256Hex) {
    return {
      ok: false,
      reason: 'hash-mismatch',
      message: "The downloaded file didn't match the model Gerson expects.",
    };
  }
  return { ok: true };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// In-memory only: a download in flight is a property of this tab, not a
// persisted fact. A reload during a download leaves only an orphaned temp
// file — modelReady() reports false and the state is simply 'absent' again,
// matching spec §7.3's "retry from zero, manually".
let downloading = false;

export async function getModelState(): Promise<ModelState> {
  if (downloading) return 'downloading';
  return (await modelReady()) ? 'ready' : 'absent';
}

// Must only be called after the user has consented (spec §8) — this module
// has no UI, so consent itself lives in the caller (ModelDownloadModal).
export async function downloadModel(onProgress?: ModelDownloadProgress): Promise<ModelDownloadResult> {
  if (downloading) {
    return { ok: false, reason: 'network', message: 'A download is already in progress.' };
  }
  downloading = true;
  try {
    return await runDownload(onProgress);
  } finally {
    downloading = false;
  }
}

async function runDownload(onProgress?: ModelDownloadProgress): Promise<ModelDownloadResult> {
  let resp: Response;
  try {
    resp = await fetch(MODEL_URL);
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
  if (!resp.ok || !resp.body) {
    return { ok: false, reason: 'network', message: `Model download failed: HTTP ${resp.status}` };
  }

  const contentLengthHeader = resp.headers.get('Content-Length');
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.byteLength;
      onProgress?.(receivedBytes, contentLength);
    }
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    await writeModelTemp(bytes);
  } catch (e) {
    await deleteModelTemp();
    return { ok: false, reason: 'storage', message: e instanceof Error ? e.message : String(e) };
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualSha256Hex = toHex(new Uint8Array(digest));

  const verified = verifyModelBytes(bytes.byteLength, contentLength, actualSha256Hex);
  if (!verified.ok) {
    await deleteModelTemp();
    return verified;
  }

  try {
    await commitModelTemp();
  } catch (e) {
    await deleteModelTemp();
    return { ok: false, reason: 'storage', message: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true };
}
