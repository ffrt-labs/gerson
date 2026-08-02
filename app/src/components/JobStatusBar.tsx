import { useState } from 'react';

export function JobStatusBar() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="job-status-bar">
      <button
        className="job-status-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-label="Separation queue"
      >
        No active jobs
      </button>
      {expanded && (
        <div className="job-status-panel" role="region" aria-label="Separation queue">
          <p>No separations queued.</p>
        </div>
      )}
    </div>
  );
}
