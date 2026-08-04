/**
 * User-facing copy for the job queue and failure surface, kept in one place
 * so the wording stays consistent between the Library and the job status bar.
 */

import type { SeparationFailureCause } from '../domain/types.ts';

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
