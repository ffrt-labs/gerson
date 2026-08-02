import { Link } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar';

export function Player() {
  return (
    <div className="surface">
      <header className="surface-header">
        <Link to="/" className="back-link">← Library</Link>
        <h1>Player</h1>
      </header>
      <main className="surface-main player-main">
        <p className="empty-state">No song open.</p>
      </main>
      <JobStatusBar />
    </div>
  );
}
