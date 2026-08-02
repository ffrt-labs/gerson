import { Link } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar';

export function Library() {
  return (
    <div className="surface">
      <header className="surface-header">
        <h1>Gerson</h1>
      </header>
      <main className="surface-main library-main">
        <p className="empty-state">No songs yet. Drop an audio file to get started.</p>
        <Link to="/player" className="dev-nav-link">[dev] open empty player →</Link>
      </main>
      <JobStatusBar />
    </div>
  );
}
