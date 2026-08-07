/**
 * User-facing copy for the job queue and failure surface, kept in one place
 * so the wording stays consistent between the Library and the job status bar.
 */

import type { SeparationFailureCause } from '../domain/types.ts';
import type { ModelDownloadFailureReason } from './model.ts';

// Attached to the running job. Neutral language, not a warning — it is the
// consequence of a deliberate design choice (one job at a time, app stays
// usable), not an error.
export const CPU_CONTENTION_NOTICE = 'Playback may stutter while a separation is running.';

// Shown alongside Resume on an interrupted job.
export const RESUME_NOTICE = 'Resuming starts the separation over from the beginning.';

// Causes are named, not generalised, because they lead to different actions.
export function causeAdvice(cause: SeparationFailureCause): string {
  switch (cause) {
    case 'worker':
      return 'This can happen when memory runs low — try closing other tabs or apps, then retry.';
    case 'storage':
      return "The result couldn't be saved to storage. Free up space, then retry.";
    case 'stalled':
      return "The separation stopped responding and had to be restarted. Try again — if it keeps happening, the file or device may be running low on resources.";
  }
}

// Shown before the first-ever download (spec §8) — consent, not a notice.
export const MODEL_CONSENT_TITLE = 'Download the separation model?';
export const MODEL_CONSENT_BODY =
  "Splitting a song needs an 80 MB model, downloaded once and kept on this device. " +
  "The rest of Gerson — your library, playback, export — works offline either way.";

// Shown while a download from another action is already in flight.
export const MODEL_DOWNLOADING_NOTICE =
  'The separation model is still downloading — try again once it finishes.';

// A download failure blocks separation only — never presented as the app
// having failed to load (spec §7.3).
export function modelDownloadFailureAdvice(reason: ModelDownloadFailureReason): string {
  switch (reason) {
    case 'truncated':
      return 'The download was interrupted before it finished. Your library still works — retry when ready.';
    case 'hash-mismatch':
      return "The downloaded file didn't match what Gerson expected and was discarded. Retry when ready.";
    case 'network':
      return "The download couldn't complete — check your connection and retry when ready.";
    case 'storage':
      return "The download couldn't be saved to storage. Free up space, then retry.";
  }
}

// Shown once, at startup, when reconciliation (storage/reconcile.ts) finds
// catalogue rows whose files are gone (spec §7.2, §12: "Export is the
// backup"). One origin-level notice naming the count, never one per Song.
export function evictionMessage(removedCount: number): string {
  const noun = removedCount === 1 ? 'song needs' : 'songs need';
  return (
    `Your browser cleared Gerson's stored audio. ${removedCount} ${noun} to be separated again. ` +
    'Exporting stems is the only backup — browsers can clear this storage without warning.'
  );
}

// Shown once, at startup, when the origin's quota is the ~300 MB "clear
// site data on close" ceiling (spec §7.2, research/03 §2). Framed as a
// browser setting, never as a storage error — a persist() refusal folds
// into this same message rather than being raised as its own notice.
export function smallQuotaMessage(persistDenied: boolean): string {
  const base =
    'This browser is set to "Clear cookies and site data when you close all windows" ' +
    '(Privacy and security → Site settings), which limits what Gerson can store to about ' +
    '300 MB — room for about one song. Turning that setting off for this site lets a library ' +
    'persist between sessions.';
  if (!persistDenied) return base;
  return `${base} Gerson also asked to keep this data past the usual cleanup, and the browser declined.`;
}
