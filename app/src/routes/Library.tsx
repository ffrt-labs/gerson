import { useRef, useState, useCallback, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar.tsx';
import { UpdateBanner } from '../components/UpdateBanner.tsx';
import { ImportMappingModal } from '../components/ImportMappingModal.tsx';
import { ModelDownloadModal } from '../components/ModelDownloadModal.tsx';
import { useLibrary } from '../hooks/useLibrary.ts';
import { enqueue, type EnqueueResult } from '../intake/enqueue.ts';
import { STEMS_SIZE_BYTES } from '../intake/space.ts';
import { tooLongMessage } from '../intake/length.ts';
import type { Role, Separation, Song } from '../domain/types.ts';
import { queuePosition, orderedQueue } from '../separation/queue.ts';
import { CPU_CONTENTION_NOTICE, interruptedNotice, MODEL_DOWNLOADING_NOTICE, causeAdvice } from '../separation/copy.ts';
import { estimateMinutes } from '../separation/estimate.ts';
import { unzip } from '../import/unzip.ts';
import { prepareImport, commitImport, type PrepareResult, type MappingCandidate } from '../import/importSet.ts';
import type { DecodedCandidate } from '../import/decodeCandidate.ts';

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatDuration(durationSec: number): string {
  return `${Math.round(durationSec / 60)}m ${Math.round(durationSec % 60)}s`;
}

function isZipFile(file: File): boolean {
  return file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip');
}

interface MappingState {
  title: string;
  candidates: MappingCandidate[];
  decoded: Record<string, DecodedCandidate>;
}

interface SeparationActions {
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
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
        detail={interruptedNotice(sep.durationSec)}
        controls={<>
          {/* Not "Retry": interruption names an event, not a defect. The
              user is choosing whether to spend the time again, not
              repairing a fault. */}
          <button onClick={() => actions.onRetry(sep.id)}>Start over</button>
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

function SongRow({
  song,
  onRename,
  onDelete,
}: {
  song: Song;
  onRename: (id: string, title: string) => void;
  onDelete: (song: Song) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(song.title);
  const cancelledRef = useRef(false);

  const startEditing = () => {
    setDraft(song.title);
    cancelledRef.current = false;
    setEditing(true);
  };

  const commit = () => {
    if (!cancelledRef.current) onRename(song.id, draft);
    setEditing(false);
  };

  return (
    <li className="library-item">
      {editing ? (
        <input
          className="library-item-title-input"
          value={draft}
          autoFocus
          aria-label={`Rename ${song.title}`}
          onFocus={e => e.target.select()}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              cancelledRef.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <Link to={`/player/${song.id}`} className="library-item-link">
          <span className="library-item-title">{song.title}</span>
          <span className="library-item-meta">
            {Math.round(song.durationSec / 60)}m {Math.round(song.durationSec % 60)}s
          </span>
        </Link>
      )}
      <div className="library-item-controls">
        <button onClick={startEditing}>Rename</button>
        <button onClick={() => onDelete(song)}>Delete</button>
      </div>
    </li>
  );
}

function Notice({ result }: { result: EnqueueResult | null }) {
  if (!result) return null;
  if (result.kind === 'queued') return null;
  if (result.kind === 'exists') return null; // navigation handled in handleFile
  if (result.kind === 'model_absent') return null; // the consent modal handles this

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
    case 'toolong':
      msg = tooLongMessage(result.durationSec);
      break;
    case 'decode_failed':
      msg = result.message;
      break;
    case 'model_downloading':
      msg = MODEL_DOWNLOADING_NOTICE;
      break;
  }

  return <p className="library-notice">{msg}</p>;
}

export function Library() {
  const {
    separations,
    songs,
    loading,
    evictionNotice,
    quotaNotice,
    addSeparation,
    addSong,
    cancelSeparation,
    dismissSeparation,
    retrySeparation,
    reorderSeparation,
    renameSong,
    deleteSong,
  } = useLibrary();
  const navigate = useNavigate();
  const handleDeleteSong = useCallback(
    (song: Song) => {
      if (window.confirm(`Delete "${song.title}"? This removes it and its stems permanently.`)) {
        deleteSong(song.id);
      }
    },
    [deleteSong],
  );
  const separationActions: SeparationActions = {
    onCancel: cancelSeparation,
    onRetry: retrySeparation,
    onDismiss: dismissSeparation,
    onReorder: reorderSeparation,
  };
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<EnqueueResult | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const [mappingSubmitting, setMappingSubmitting] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [modelDownloadFile, setModelDownloadFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enqueues each file in turn — sequentially, so their Separations get
  // distinct, correctly-ordered queueOrder values, and so several files
  // dropped at once each become their own queued Separation rather than
  // only the first one. No processing/guard management here — both
  // handleFiles (the top-level single-file entry) and the import pipeline's
  // redirect case (§6.2: "one file where four are expected") call this
  // directly from within a context that already owns `processing`.
  const enqueueFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const result = await enqueue(file);
        if (result.kind === 'exists' && files.length === 1) {
          navigate(`/player/${result.id}`);
          return;
        }
        if (result.kind === 'model_absent') {
          setModelDownloadFile(file);
          return;
        }
        setLastResult(result);
        if (result.kind === 'queued') {
          addSeparation(result.separation);
        }
      }
    },
    [addSeparation, navigate],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || processing) return;
      setProcessing(true);
      setLastResult(null);
      try {
        await enqueueFiles(files);
      } finally {
        setProcessing(false);
      }
    },
    [enqueueFiles, processing],
  );

  // Dispatches every outcome of the import pipeline (§6.2) to a notice,
  // navigation, a redirect back into separation, or the mapping modal.
  // Async (and always awaited by its callers) because 'redirect' hands off
  // to enqueueFiles, which the caller's own processing-guard finally block
  // must wait on rather than firing and forgetting.
  const handlePrepareResult = useCallback(
    async (result: PrepareResult) => {
      switch (result.kind) {
        case 'redirect':
          await enqueueFiles([new File([result.file.bytes as BlobPart], result.file.name)]);
          return;
        case 'refuse-partial':
          setImportNotice(
            `Dropped ${result.count} files — a stem set needs exactly four (or one file to separate).`,
          );
          return;
        case 'duplicate-names':
          setImportNotice(
            `Two of the dropped files are both named "${result.names[0]}" — rename one and try again.`,
          );
          return;
        case 'decode-failed':
          setImportNotice(`"${result.name}": ${result.message}`);
          return;
        case 'refuse-length':
          setImportNotice(
            `These files don't line up closely enough to be one stem set — ` +
              result.durations.map(d => `"${d.name}" ${formatDuration(d.durationSec)}`).join(', ') + '.',
          );
          return;
        case 'inflight':
          setImportNotice(`"${result.title}" is already being separated.`);
          return;
        case 'nospace':
          setImportNotice(`Not enough storage. ${formatBytes(result.needsBytes)} needed.`);
          return;
        case 'exists':
          navigate(`/player/${result.id}`);
          return;
        case 'imported':
          addSong(result.song);
          navigate(`/player/${result.song.id}`);
          return;
        case 'needs-mapping':
          setMapping({ title: result.title, candidates: result.candidates, decoded: result.decoded });
          return;
      }
    },
    [enqueueFiles, addSong, navigate],
  );

  const handleImportZip = useCallback(
    async (file: File) => {
      setProcessing(true);
      setLastResult(null);
      setImportNotice(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let entries;
        try {
          entries = await unzip(bytes);
        } catch (e) {
          setImportNotice(e instanceof Error ? e.message : String(e));
          return;
        }
        if (entries.length === 0) {
          setImportNotice('This zip has no files in it.');
          return;
        }
        await handlePrepareResult(await prepareImport(entries));
      } finally {
        setProcessing(false);
      }
    },
    [handlePrepareResult],
  );

  const handleImportFiles = useCallback(
    async (files: File[]) => {
      setProcessing(true);
      setLastResult(null);
      setImportNotice(null);
      try {
        const rawFiles = await Promise.all(
          files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
        );
        await handlePrepareResult(await prepareImport(rawFiles));
      } finally {
        setProcessing(false);
      }
    },
    [handlePrepareResult],
  );

  // The single top-level entry point for a drop or a file-picker selection:
  // one drop zone, and the drop decides (§6.2). A lone .zip is unpacked; a
  // lone non-zip file keeps today's separation path unchanged; anything
  // else is a stem-set import candidate.
  const handleIncoming = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || processing) return;
      if (files.length === 1 && isZipFile(files[0])) {
        await handleImportZip(files[0]);
        return;
      }
      if (files.length === 1) {
        await handleFiles(files);
        return;
      }
      await handleImportFiles(files);
    },
    [processing, handleFiles, handleImportZip, handleImportFiles],
  );

  const handleMappingCancel = useCallback(() => {
    setMapping(null);
    setMappingError(null);
  }, []);

  const handleMappingConfirm = useCallback(
    async (assignment: Record<string, Role>) => {
      if (!mapping) return;
      setMappingSubmitting(true);
      setMappingError(null);
      try {
        const byRole = {} as Record<Role, DecodedCandidate>;
        for (const [name, role] of Object.entries(assignment)) {
          byRole[role] = mapping.decoded[name];
        }
        const result = await commitImport(byRole, mapping.title, null);
        if (result.kind === 'inflight') {
          setMappingError(`"${result.title}" is already being separated.`);
          return;
        }
        if (result.kind === 'nospace') {
          setMappingError(`Not enough storage. ${formatBytes(result.needsBytes)} needed.`);
          return;
        }
        if (result.kind === 'imported') addSong(result.song);
        navigate(`/player/${result.song.id}`);
        setMapping(null);
      } catch (e) {
        setMappingError(e instanceof Error ? e.message : String(e));
      } finally {
        setMappingSubmitting(false);
      }
    },
    [mapping, addSong, navigate],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragging(false);
      handleIncoming(Array.from(e.dataTransfer.files));
    },
    [handleIncoming],
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
      handleIncoming(files);
      // Reset so the same file(s) can be picked again
      e.target.value = '';
    },
    [handleIncoming],
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
          accept="audio/*,.zip,application/zip"
          multiple
          aria-hidden="true"
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </header>

      <main className="surface-main library-main">
        {evictionNotice && <p className="library-notice">{evictionNotice}</p>}
        {quotaNotice && <p className="library-notice">{quotaNotice}</p>}
        <Notice result={lastResult} />
        {importNotice && <p className="library-notice">{importNotice}</p>}

        {loading ? null : isEmpty ? (
          <p className="empty-state">No songs yet — drop an audio file or click "Add a song".</p>
        ) : (
          <ul className="library-list">
            {songs.map(song => (
              <SongRow key={song.id} song={song} onRename={renameSong} onDelete={handleDeleteSong} />
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

      <UpdateBanner separations={separations} />
      <JobStatusBar separations={separations} onCancel={cancelSeparation} />

      {mapping && (
        <ImportMappingModal
          title={mapping.title}
          candidates={mapping.candidates}
          submitting={mappingSubmitting}
          error={mappingError}
          onConfirm={handleMappingConfirm}
          onCancel={handleMappingCancel}
        />
      )}

      {modelDownloadFile && (
        <ModelDownloadModal
          onCancel={() => setModelDownloadFile(null)}
          onReady={() => {
            const file = modelDownloadFile;
            setModelDownloadFile(null);
            void handleFiles([file]);
          }}
        />
      )}
    </div>
  );
}
