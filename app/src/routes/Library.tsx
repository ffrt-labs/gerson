import { useRef, useState, useCallback, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar.tsx';
import { useLibrary } from '../hooks/useLibrary.ts';
import { enqueue, type EnqueueResult } from '../intake/enqueue.ts';
import { STEMS_SIZE_BYTES } from '../intake/space.ts';
import type { Separation } from '../domain/types.ts';
import { queuePosition } from '../separation/queue.ts';
import { CPU_CONTENTION_NOTICE, RESUME_NOTICE, causeAdvice } from '../separation/copy.ts';

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// ~1.28× song duration based on observed htdemucs timing on a single worker.
function estimateMinutes(durationSec: number): number {
  return Math.max(1, Math.round((durationSec * 1.28) / 60));
}

interface SeparationActions {
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onResume: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
}

function SeparationRow({
  sep,
  separations,
  actions,
}: {
  sep: Separation;
  separations: Separation[];
  actions: SeparationActions;
}) {
  if (sep.status === 'failed') {
    return (
      <li className="library-item library-item--separation">
        <div className="library-item-main">
          <span className="library-item-title">{sep.title}</span>
          <span className="library-item-badge library-item-badge--failed">failed</span>
        </div>
        <p className="library-item-detail">
          {new Date(sep.failedAt ?? sep.startedAt).toLocaleString()} — {causeAdvice(sep.cause ?? 'worker')}
        </p>
        <div className="library-item-controls">
          <button onClick={() => actions.onRetry(sep.id)}>Retry</button>
          <button onClick={() => actions.onDismiss(sep.id)}>Dismiss</button>
        </div>
      </li>
    );
  }

  if (sep.status === 'running') {
    return (
      <li className="library-item library-item--separation">
        <div className="library-item-main">
          <span className="library-item-title">{sep.title}</span>
          <span className="library-item-badge library-item-badge--running">
            {Math.round(sep.progress * 100)}%
          </span>
        </div>
        <p className="library-item-detail">{CPU_CONTENTION_NOTICE}</p>
        <div className="library-item-controls">
          <button onClick={() => actions.onCancel(sep.id)}>Cancel</button>
        </div>
      </li>
    );
  }

  if (sep.interrupted) {
    return (
      <li className="library-item library-item--separation">
        <div className="library-item-main">
          <span className="library-item-title">{sep.title}</span>
          <span className="library-item-badge library-item-badge--interrupted">interrupted</span>
        </div>
        <p className="library-item-detail">{RESUME_NOTICE}</p>
        <div className="library-item-controls">
          <button onClick={() => actions.onResume(sep.id)}>Resume</button>
          <button onClick={() => actions.onCancel(sep.id)}>Cancel</button>
        </div>
      </li>
    );
  }

  // queued
  const position = queuePosition(separations, sep.id);
  const total = separations.filter(s => s.status === 'queued' && !s.interrupted).length;
  const est = estimateMinutes(sep.durationSec);
  return (
    <li className="library-item library-item--separation">
      <div className="library-item-main">
        <span className="library-item-title">{sep.title}</span>
        <span className="library-item-badge library-item-badge--queued">
          queued · position {position ?? '—'} of {total} · ~{est} min
        </span>
      </div>
      <div className="library-item-controls">
        <button
          onClick={() => actions.onReorder(sep.id, 'up')}
          disabled={position === null || position <= 1}
          aria-label={`Move ${sep.title} up in queue`}
        >
          ▲
        </button>
        <button
          onClick={() => actions.onReorder(sep.id, 'down')}
          disabled={position === null || position >= total}
          aria-label={`Move ${sep.title} down in queue`}
        >
          ▼
        </button>
        <button onClick={() => actions.onCancel(sep.id)}>Cancel</button>
      </div>
    </li>
  );
}

function Notice({ result }: { result: EnqueueResult | null }) {
  if (!result) return null;
  if (result.kind === 'queued') return null;
  if (result.kind === 'exists') return null; // navigation handled in handleFile

  let msg: string;
  switch (result.kind) {
    case 'inflight':
      msg = `"${result.title}" is already being separated.`;
      break;
    case 'mobile':
      msg =
        'Separation requires too much memory for a mobile device. ' +
        'Use import to bring in stems separated on another device.';
      break;
    case 'nospace':
      msg = `Not enough storage. ${formatBytes(result.needsBytes)} needed (${formatBytes(STEMS_SIZE_BYTES)} for stems plus the recording).`;
      break;
    case 'decode_failed':
      msg = result.message;
      break;
  }

  return <p className="library-notice">{msg}</p>;
}

export function Library() {
  const {
    separations,
    songs,
    loading,
    addSeparation,
    cancelSeparation,
    dismissSeparation,
    retrySeparation,
    resumeSeparation,
    reorderSeparation,
  } = useLibrary();
  const navigate = useNavigate();
  const separationActions: SeparationActions = {
    onCancel: cancelSeparation,
    onRetry: retrySeparation,
    onDismiss: dismissSeparation,
    onResume: resumeSeparation,
    onReorder: reorderSeparation,
  };
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<EnqueueResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setProcessing(true);
      setLastResult(null);
      try {
        const result = await enqueue(file);
        if (result.kind === 'exists') {
          navigate(`/player/${result.id}`);
          return;
        }
        setLastResult(result);
        if (result.kind === 'queued') {
          addSeparation(result.separation);
        }
      } finally {
        setProcessing(false);
      }
    },
    [addSeparation, navigate],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be picked again
      e.target.value = '';
    },
    [handleFile],
  );

  const isEmpty = separations.length === 0 && songs.length === 0;

  return (
    <div
      className={['surface', dragging ? 'surface--drop-active' : ''].filter(Boolean).join(' ')}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <header className="surface-header">
        <h1>Gerson</h1>
        <button
          className="pick-file-btn"
          onClick={() => inputRef.current?.click()}
          disabled={processing}
        >
          {processing ? 'Checking…' : 'Add a song'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          aria-hidden="true"
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </header>

      <main className="surface-main library-main">
        <Notice result={lastResult} />

        {loading ? null : isEmpty ? (
          <p className="empty-state">No songs yet — drop an audio file or click "Add a song".</p>
        ) : (
          <ul className="library-list">
            {songs.map(song => (
              <li key={song.id} className="library-item">
                <Link to={`/player/${song.id}`} className="library-item-link">
                  <span className="library-item-title">{song.title}</span>
                  <span className="library-item-meta">
                    {Math.round(song.durationSec / 60)}m {Math.round(song.durationSec % 60)}s
                  </span>
                </Link>
              </li>
            ))}
            {separations.map(sep => (
              <SeparationRow
                key={sep.id}
                sep={sep}
                separations={separations}
                actions={separationActions}
              />
            ))}
          </ul>
        )}

        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <p>Drop to add song</p>
          </div>
        )}
      </main>

      <JobStatusBar separations={separations} onCancel={cancelSeparation} />
    </div>
  );
}
