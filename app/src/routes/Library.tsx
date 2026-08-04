import { useRef, useState, useCallback, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar.tsx';
import { useLibrary } from '../hooks/useLibrary.ts';
import { enqueue, type EnqueueResult } from '../intake/enqueue.ts';
import { STEMS_SIZE_BYTES } from '../intake/space.ts';
import type { Separation } from '../domain/types.ts';
import { queuePosition, orderedQueue } from '../separation/queue.ts';
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

// The shell every Separation row shares — a title, a status badge, an
// optional explanatory line, and a row of controls. Branches below only
// decide what goes in each slot.
function SeparationShell({
  title,
  badge,
  detail,
  controls,
}: {
  title: string;
  badge: React.ReactNode;
  detail?: string;
  controls: React.ReactNode;
}) {
  return (
    <li className="library-item library-item--separation">
      <div className="library-item-main">
        <span className="library-item-title">{title}</span>
        {badge}
      </div>
      {detail && <p className="library-item-detail">{detail}</p>}
      <div className="library-item-controls">{controls}</div>
    </li>
  );
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
      <SeparationShell
        title={sep.title}
        badge={<span className="library-item-badge library-item-badge--failed">failed</span>}
        detail={`${new Date(sep.failedAt ?? sep.startedAt).toLocaleString()} — ${causeAdvice(sep.cause ?? 'worker')}`}
        controls={<>
          <button onClick={() => actions.onRetry(sep.id)}>Retry</button>
          <button onClick={() => actions.onDismiss(sep.id)}>Dismiss</button>
        </>}
      />
    );
  }

  if (sep.status === 'running') {
    return (
      <SeparationShell
        title={sep.title}
        badge={
          <span className="library-item-badge library-item-badge--running">
            {Math.round(sep.progress * 100)}%
          </span>
        }
        detail={CPU_CONTENTION_NOTICE}
        controls={<button onClick={() => actions.onCancel(sep.id)}>Cancel</button>}
      />
    );
  }

  if (sep.interrupted) {
    return (
      <SeparationShell
        title={sep.title}
        badge={<span className="library-item-badge library-item-badge--interrupted">interrupted</span>}
        detail={RESUME_NOTICE}
        controls={<>
          <button onClick={() => actions.onResume(sep.id)}>Resume</button>
          <button onClick={() => actions.onCancel(sep.id)}>Cancel</button>
        </>}
      />
    );
  }

  // queued
  const position = queuePosition(separations, sep.id);
  const total = orderedQueue(separations).length;
  const est = estimateMinutes(sep.durationSec);
  return (
    <SeparationShell
      title={sep.title}
      badge={
        <span className="library-item-badge library-item-badge--queued">
          queued · position {position ?? '—'} of {total} · ~{est} min
        </span>
      }
      controls={<>
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
      </>}
    />
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

  // Enqueues each file in turn — sequentially, so their Separations get
  // distinct, correctly-ordered queueOrder values, and so several files
  // dropped at once each become their own queued Separation rather than
  // only the first one.
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || processing) return;
      setProcessing(true);
      setLastResult(null);
      try {
        for (const file of files) {
          const result = await enqueue(file);
          if (result.kind === 'exists' && files.length === 1) {
            navigate(`/player/${result.id}`);
            return;
          }
          setLastResult(result);
          if (result.kind === 'queued') {
            addSeparation(result.separation);
          }
        }
      } finally {
        setProcessing(false);
      }
    },
    [addSeparation, navigate, processing],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles],
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
      const files = Array.from(e.target.files ?? []);
      handleFiles(files);
      // Reset so the same file(s) can be picked again
      e.target.value = '';
    },
    [handleFiles],
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
          multiple
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
