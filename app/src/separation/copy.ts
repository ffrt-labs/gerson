/**
 * User-facing copy for the job queue and failure surface, kept in one place
 * so the wording stays consistent between the Library and the job status bar.
 */

import type { SeparationFailureCause } from '../domain/types.ts';
import type { ModelDownloadFailureReason } from './model.ts';
import { estimateMinutes } from './estimate.ts';

// Attached to the running job. Neutral language, not a warning — it is the
// consequence of a deliberate design choice (one job at a time, app stays
// usable), not an error.
export const CPU_CONTENTION_NOTICE = 'Playback may stutter while a separation is running.';

// Shown alongside "Start over" on an interrupted job.
//
// This replaces a notice that existed only to take its own button label back
// ("Resuming starts the separation over from the beginning") — an app that
// spends a sentence undoing its own label has the wrong label, so the truth
// moved into the label and this line was freed for something useful.
//
// Two things it must not do. It must not claim to know *how* the Separation
// stopped: the engine cannot tell a closed tab from a reload, so the copy
// doesn't pretend to. And it must never quote prior progress — the row is
// written back with progress: 0, so "it reached 62%" would imply partial
// credit the engine does not have, reintroducing in prose exactly the
// misunderstanding the relabel removes.
export function interruptedNotice(durationSec: number): string {
  return (
    'This separation stopped when Gerson was closed or reloaded. ' +
    `Starting over runs the whole thing again — about ${estimateMinutes(durationSec)} minutes.`
  );
}

// Causes are named, not generalised, because they lead to different actions.
export function causeAdvice(cause: SeparationFailureCause): string {
  switch (cause) {
    case 'worker':
      return 'This can happen when memory runs low — try closing other tabs or apps, then retry.';
    case 'storage':
      return "The result couldn't be saved to storage. Free up space, then retry.";
    case 'stalled':
      // No attribution here, deliberately. The previous wording blamed "the
      // file or device running low on resources" — which is wrong, not just
      // clumsy: memory pressure surfaces as a catchable RuntimeError under
      // cause 'worker', which owns the low-memory advice above. A 'stalled'
      // failure is silence, and silence names no cause.
      return 'The separation stopped responding and was given up on. Starting over runs the whole thing again.';
    case 'decode':
      return "This file couldn't be read as audio — check it's a supported format.";
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
