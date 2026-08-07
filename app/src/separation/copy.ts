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
