import type { Separation } from '../domain/types.ts';
import { queuePosition, orderedQueue } from '../separation/queue.ts';
import { estimateMinutes, estimateSeconds } from '../separation/estimate.ts';
import { CPU_CONTENTION_NOTICE, interruptedNotice, causeAdvice } from '../separation/copy.ts';
import { tooLongMessage } from '../intake/length.ts';
import { formatClock } from '../format/units.ts';

export interface SeparationActions {
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
}

function minutesLeft(sep: Separation): number {
  const remaining = estimateSeconds(sep.durationSec) * (1 - sep.progress);
  return Math.max(1, Math.round(remaining / 60));
}

/**
 * The running job (design 1c-d): a lime-bordered panel, because a
 * Separation is the one thing in Gerson that takes real time and the user
 * needs to find it without hunting. The percentage is the loudest thing on
 * it; the CPU-contention notice is verbatim from copy.ts, and stays neutral
 * — it names a deliberate design choice, not an error.
 */
export function RunningPanel({ sep, actions }: { sep: Separation; actions: SeparationActions }) {
  const percent = Math.round(sep.progress * 100);
  return (
    <section className="job-panel job-panel--running">
      <div className="job-panel-head">
        <span className="job-dot" aria-hidden="true" />
        <span className="legend">Separating</span>
        <span className="job-panel-title">{sep.title}</span>
        <span className="job-panel-percent mono">{percent}%</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="job-panel-foot">
        <span className="legend legend--sm">About {minutesLeft(sep)} min left</span>
        <p className="job-panel-notice">{CPU_CONTENTION_NOTICE}</p>
        <button type="button" className="btn btn--ghost btn--dense" onClick={() => actions.onCancel(sep.id)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * A queued job (design 1c-d): position, filename, its own cost, and the two
 * reorder arrows. The unavailable direction is disabled rather than hidden,
 * so the pair doesn't reflow as a row moves through the queue.
 */
export function QueuedRow({
  sep,
  separations,
  actions,
}: {
  sep: Separation;
  separations: Separation[];
  actions: SeparationActions;
}) {
  const position = queuePosition(separations, sep.id);
  const total = orderedQueue(separations).length;

  return (
    <li className="queue-row">
      <span className="queue-row-position mono">{position ?? '—'}</span>
      <div className="queue-row-text">
        <span className="queue-row-title">{sep.title}</span>
        <span className="queue-row-meta mono">
          {formatClock(sep.durationSec)} · ~{estimateMinutes(sep.durationSec)} min
        </span>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        onClick={() => actions.onReorder(sep.id, 'up')}
        disabled={position === null || position <= 1}
        aria-label={`Move ${sep.title} up in queue`}
      >
        <span className="icon" aria-hidden="true">keyboard_arrow_up</span>
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        onClick={() => actions.onReorder(sep.id, 'down')}
        disabled={position === null || position >= total}
        aria-label={`Move ${sep.title} down in queue`}
      >
        <span className="icon" aria-hidden="true">keyboard_arrow_down</span>
      </button>
      <button type="button" className="btn btn--ghost btn--dense" onClick={() => actions.onCancel(sep.id)}>
        Cancel
      </button>
    </li>
  );
}

/**
 * The two alert cards (design 1c-e), distinguished by colour *and* by the
 * action they offer.
 *
 * Failed gets a primary Retry: something went wrong and repairing it is the
 * obvious next move. Interrupted gets a *secondary* "Start over" — it costs
 * the user nine minutes, so it should not be the brightest thing on screen,
 * and "Start over" rather than "Retry" because interruption names an event,
 * not a defect.
 *
 * The length-cap refusal is quieter still: it has no retry that can
 * succeed, so Dismiss is the only honest action.
 */
export function AlertCard({ sep, actions }: { sep: Separation; actions: SeparationActions }) {
  if (sep.status === 'failed') {
    // 'toolong' is the one cause Retry cannot fix — the Recording will never
    // fit, however many times it's tried.
    const tooLong = sep.cause === 'toolong';
    if (tooLong) {
      return (
        <section className="alert-card alert-card--quiet">
          <span className="icon alert-card-icon" aria-hidden="true">warning</span>
          <div className="alert-card-text">
            <span className="badge badge--loop">Too long to split</span>
            <p className="alert-card-copy">{tooLongMessage(sep.durationSec)}</p>
          </div>
          <div className="alert-card-actions">
            <button type="button" className="btn btn--ghost btn--default-tap" onClick={() => actions.onDismiss(sep.id)}>
              Dismiss
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className="alert-card alert-card--failed">
        <span className="icon alert-card-icon" aria-hidden="true">error</span>
        <div className="alert-card-text">
          <div className="alert-card-head">
            <span className="badge badge--danger">Couldn't finish</span>
            <span className="alert-card-time mono">
              {new Date(sep.failedAt ?? sep.startedAt).toLocaleString()}
            </span>
          </div>
          <span className="alert-card-title">{sep.title}</span>
          <p className="alert-card-copy">{causeAdvice(sep.cause ?? 'worker')}</p>
        </div>
        <div className="alert-card-actions">
          <button type="button" className="btn btn--primary btn--default-tap" onClick={() => actions.onRetry(sep.id)}>
            <span className="icon" aria-hidden="true">refresh</span>
            Retry
          </button>
          <button type="button" className="btn btn--ghost btn--default-tap" onClick={() => actions.onDismiss(sep.id)}>
            Dismiss
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="alert-card alert-card--interrupted">
      <span className="icon alert-card-icon" aria-hidden="true">pause_circle</span>
      <div className="alert-card-text">
        <div className="alert-card-head">
          <span className="badge badge--loop">Stopped part-way</span>
        </div>
        <span className="alert-card-title">{sep.title}</span>
        <p className="alert-card-copy">{interruptedNotice(sep.durationSec)}</p>
      </div>
      <div className="alert-card-actions">
        <button type="button" className="btn btn--secondary btn--default-tap" onClick={() => actions.onRetry(sep.id)}>
          <span className="icon" aria-hidden="true">restart_alt</span>
          Start over
        </button>
        <button type="button" className="btn btn--ghost btn--default-tap" onClick={() => actions.onCancel(sep.id)}>
          Cancel
        </button>
      </div>
    </section>
  );
}
