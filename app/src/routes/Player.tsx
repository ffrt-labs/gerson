import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar';
import { getSong } from '../storage/db.ts';
import type { Song } from '../domain/types.ts';

export function Player() {
  const { id } = useParams<{ id: string }>();
  // Keyed by id, so a stale result from a previous id reads as loading
  // rather than flashing the old Song.
  const [result, setResult] = useState<{ id: string; song: Song | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getSong(id).then(found => {
      if (!cancelled) setResult({ id, song: found ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // undefined = loading (or stale for a previous id), null = Song not found.
  const song = result && result.id === id ? result.song : undefined;

  return (
    <div className="surface">
      <header className="surface-header">
        <Link to="/" className="back-link">← Library</Link>
        <h1>{song ? song.title : 'Player'}</h1>
      </header>
      <main className="surface-main player-main">
        {!id ? (
          <p className="empty-state">No song open.</p>
        ) : song === undefined ? null : song === null ? (
          <p className="empty-state">Song not found.</p>
        ) : (
          <p className="empty-state">Nothing to play yet.</p>
        )}
      </main>
      <JobStatusBar />
    </div>
  );
}
