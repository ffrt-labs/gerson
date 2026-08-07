import { useState } from 'react';
import type { Separation } from '../domain/types.ts';
import { queuePosition, isActive } from '../separation/queue.ts';
import { CPU_CONTENTION_NOTICE } from '../separation/copy.ts';

interface JobStatusBarProps {
  separations?: Separation[];
  onCancel?: (id: string) => void;
}

export function JobStatusBar({ separations = [], onCancel }: JobStatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  const active = separations.filter(isActive);
  const label = active.length === 0
    ? 'No active jobs'
    : active.length === 1
      ? '1 separation in progress'
      : `${active.length} separations in progress`;

  return (
    <div className="job-status-bar">
      <button
        className="job-status-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-label="Separation queue"
      >
        {label}
      </button>
      {expanded && (
        <div className="job-status-panel" role="region" aria-label="Separation queue">
          {active.length === 0 ? (
            <p>No separations in progress.</p>
          ) : (
            <ul className="job-status-list">
              {active.map(sep => (
                <li key={sep.id} className="job-status-item">
                  <div className="job-status-item-main">
                    <span className="job-status-title">{sep.title}</span>
                    {sep.status === 'running'
                      ? <span className="job-status-progress">{Math.round(sep.progress * 100)}%</span>
                      : sep.interrupted
                        ? <span className="job-status-badge">interrupted</span>
                        : <span className="job-status-badge">
                            queue position {queuePosition(separations, sep.id) ?? '—'}
                          </span>
                    }
                    {onCancel && (
                      <button
                        className="job-status-cancel"
                        onClick={() => onCancel(sep.id)}
                        aria-label={`Cancel ${sep.title}`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {sep.status === 'running' && (
                    <p className="job-status-notice">{CPU_CONTENTION_NOTICE}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
