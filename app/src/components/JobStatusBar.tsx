import { useState } from 'react';
import type { Separation } from '../domain/types.ts';

interface JobStatusBarProps {
  separations?: Separation[];
}

export function JobStatusBar({ separations = [] }: JobStatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  const active = separations.filter(s => s.status === 'queued' || s.status === 'running');
  const label = active.length === 0
    ? 'No active jobs'
    : active.length === 1
      ? '1 separation queued'
      : `${active.length} separations queued`;

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
            <p>No separations queued.</p>
          ) : (
            <ul className="job-status-list">
              {active.map(sep => (
                <li key={sep.id} className="job-status-item">
                  <span className="job-status-title">{sep.title}</span>
                  <span className="job-status-badge">{sep.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
