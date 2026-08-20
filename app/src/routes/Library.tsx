import { useMemo, useRef, useState, useCallback, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { UpdateBanner } from '../components/UpdateBanner.tsx';
import { ImportMappingModal } from '../components/ImportMappingModal.tsx';
import { ModelDownloadModal } from '../components/ModelDownloadModal.tsx';
import { OfflineChip } from '../components/OfflineChip.tsx';
import { SongThumbnail } from '../components/SongThumbnail.tsx';
import {
  RunningPanel,
  QueuedRow,
  AlertCard,
  type SeparationActions,
} from '../components/SeparationPanels.tsx';
import { useLibrary } from '../hooks/useLibrary.ts';
import { enqueue, type EnqueueResult } from '../intake/enqueue.ts';
import { STEMS_SIZE_BYTES } from '../intake/space.ts';
import { tooLongMessage, MAX_RECORDING_SEC } from '../intake/length.ts';
import type { Role, Separation, Song } from '../domain/types.ts';
import { MODEL_DOWNLOADING_NOTICE } from '../separation/copy.ts';
import { estimateMinutes } from '../separation/estimate.ts';
import { libraryBytes } from '../library/disk.ts';
import { formatClock, formatDiskSize, formatRate, formatLengthSec } from '../format/units.ts';
import { unzip } from '../import/unzip.ts';
import { prepareImport, commitImport, type PrepareResult, type MappingCandidate } from '../import/importSet.ts';
import type { DecodedCandidate } from '../import/decodeCandidate.ts';

function isZipFile(file: File): boolean {
  return file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip');
}

interface MappingState {
  title: string;
  candidates: MappingCandidate[];
  decoded: Record<string, DecodedCandidate>;
}

// The meta line under a song title: everything the user needs to recognise
// a Song and to know what state they left it in. The loop and tempo only
// appear when they differ from the default — a row that says "1.00×" on
// every Song says nothing.
function songMeta(song: Song): string {
  const parts = [formatClock(song.durationSec), '4 stems'];
  if (song.practice.loop) {
    parts.push(`loop ${formatLengthSec(song.practice.loop.endSec - song.practice.loop.startSec)} saved`);
  }
  if (song.practice.tempo !== 1) parts.push(formatRate(song.practice.tempo));
  return parts.join(' · ');
}

function SongRow({
  song,
  onOpen,
  onRename,
  onDelete,
}: {
  song: Song;
  onOpen: (id: string) => void;
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
    <li className="song-row">
      <button
        type="button"
        className="btn btn--secondary song-row-play"
        aria-label={`Open ${song.title}`}
        onClick={() => onOpen(song.id)}
      >
        <span className="icon" aria-hidden="true">play_arrow</span>
      </button>

      {editing ? (
        <input
          className="song-row-title-input"
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
        <div className="song-row-text">
          <span className="song-row-title">{song.title}</span>
          <span className="song-row-meta mono">{songMeta(song)}</span>
        </div>
      )}

      <SongThumbnail song={song} />

      <div className="song-row-actions">
        <button type="button" className="btn btn--ghost btn--dense" onClick={startEditing}>
          <span className="icon" aria-hidden="true">edit</span>
          Rename
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--dense btn--danger"
          onClick={() => onDelete(song)}
        >
          <span className="icon" aria-hidden="true">delete</span>
          Delete
        </button>
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
      msg = `Not enough storage. ${formatDiskSize(result.needsBytes)} needed (${formatDiskSize(STEMS_SIZE_BYTES)} for stems plus the recording).`;
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

  return (
    <p className="alert-note alert-note--loop">
      <span className="icon" aria-hidden="true">info</span>
      {msg}
    </p>
  );
}

/**
 * The empty library (design 1c-b). Two columns: the drop zone, and the two
 * things a first-time user has to know before they spend nine minutes.
 *
 * The install panel is amber and deliberately prominent: on iOS a browser
 * clears stored audio after a week idle, and losing a whole library is
 * worse than any amount of onboarding friction.
 */
function EmptyLibrary({ onChooseFile, busy }: { onChooseFile: () => void; busy: boolean }) {
  return (
    <div className="empty-library">
      <div className="drop-zone">
        <span className="icon drop-zone-icon" aria-hidden="true">library_music</span>
        <h2 className="drop-zone-title">Drop a song to start</h2>
        <p className="drop-zone-copy">
          Gerson splits it into vocals, drums, bass and everything else — on this machine, without
          uploading anything.
        </p>
        <div className="drop-zone-actions">
          <button
            type="button"
            className="btn btn--primary btn--primary-tap"
            onClick={onChooseFile}
            disabled={busy}
          >
            <span className="icon" aria-hidden="true">folder_open</span>
            {busy ? 'Checking…' : 'Choose a file'}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--primary-tap"
            onClick={onChooseFile}
            disabled={busy}
          >
            <span className="icon" aria-hidden="true">unarchive</span>
            Import stems
          </button>
        </div>
        <span className="legend legend--sm">
          MP3 · WAV · FLAC · M4A — up to {MAX_RECORDING_SEC / 60} minutes
        </span>
      </div>

      <aside className="info-column">
        <section className="info-panel">
          <span className="icon" aria-hidden="true">schedule</span>
          <h3 className="info-panel-title">Splitting takes a while</h3>
          <p className="info-panel-copy">
            About {estimateMinutes(MAX_RECORDING_SEC)} minutes for a {MAX_RECORDING_SEC / 60}-minute
            song, and one at a time. You can keep using Gerson while it runs.
          </p>
        </section>
        <section className="info-panel info-panel--loop">
          <span className="icon" aria-hidden="true">install_mobile</span>
          <h3 className="info-panel-title">Install Gerson first</h3>
          <p className="info-panel-copy">
            On a phone, a browser can clear stored audio after a week unused. Installing Gerson to
            the Home Screen keeps your library where you left it.
          </p>
          {/* Instructions, not a button. There is no cross-browser way to
              trigger an install — iOS Safari has no beforeinstallprompt at
              all — and a control that does nothing on the platform this
              panel is actually warning about would be worse than the
              sentence it replaced. */}
          <p className="info-panel-copy">
            <span className="legend legend--sm">Share, then Add to Home Screen</span>
          </p>
        </section>
      </aside>
    </div>
  );
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
  // Memoized: this object is passed to every job row, and rebuilding it on
  // each Library render (which a running job triggers on every progress
  // tick) would defeat any memoization those rows grow later.
  const separationActions: SeparationActions = useMemo(
    () => ({
      onCancel: cancelSeparation,
      onRetry: retrySeparation,
      onDismiss: dismissSeparation,
      onReorder: reorderSeparation,
    }),
    [cancelSeparation, retrySeparation, dismissSeparation, reorderSeparation],
  );
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
              result.durations.map(d => `"${d.name}" ${formatClock(d.durationSec)}`).join(', ') + '.',
          );
          return;
        case 'inflight':
          setImportNotice(`"${result.title}" is already being separated.`);
          return;
        case 'nospace':
          setImportNotice(`Not enough storage. ${formatDiskSize(result.needsBytes)} needed.`);
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
          setMappingError(`Not enough storage. ${formatDiskSize(result.needsBytes)} needed.`);
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

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const openSong = useCallback((id: string) => navigate(`/player/${id}`), [navigate]);

  // Each Separation state gets its own surface rather than one polymorphic
  // row: what the user can do about a running job, a queued one and a
  // failed one have nothing in common.
  const running = separations.filter(s => s.status === 'running');
  const queued = separations.filter(s => s.status === 'queued' && !s.interrupted);
  const alerts = separations.filter(s => s.status === 'failed' || s.interrupted);

  const diskBytes = useMemo(() => libraryBytes(songs), [songs]);
  const isEmpty = separations.length === 0 && songs.length === 0;

  return (
    <div
      className="app-frame library"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <header className="app-header">
        <span className="logo-mark" aria-hidden="true">
          <span className="icon">graphic_eq</span>
        </span>
        <h1 className="logo-word">Gerson</h1>
        <div className="app-header-actions">
          <OfflineChip />
          <button
            type="button"
            className="btn btn--primary btn--default-tap"
            onClick={openPicker}
            disabled={processing}
          >
            <span className="icon" aria-hidden="true">add</span>
            {processing ? 'Checking…' : 'Add a song'}
          </button>
        </div>
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

      <main className={`app-main library-main${dragging ? ' is-drop-active' : ''}`}>
        <UpdateBanner separations={separations} />
        {evictionNotice && (
          <p className="alert-note alert-note--danger">
            <span className="icon" aria-hidden="true">error</span>
            {evictionNotice}
          </p>
        )}
        {quotaNotice && (
          <p className="alert-note alert-note--loop">
            <span className="icon" aria-hidden="true">info</span>
            {quotaNotice}
          </p>
        )}
        <Notice result={lastResult} />
        {importNotice && (
          <p className="alert-note alert-note--loop">
            <span className="icon" aria-hidden="true">info</span>
            {importNotice}
          </p>
        )}

        {/* Design 2d: separation needs a desktop, so on a phone the Library
            says so rather than offering a control that fails. Rendered
            always and hidden by width in CSS — the constraint is about the
            machine, and a narrow window on a desktop is close enough to the
            same advice to not be worth a JS capability probe. */}
        <section className="info-panel mobile-only">
          <span className="icon" aria-hidden="true">smartphone</span>
          <h3 className="info-panel-title">Separating needs a computer</h3>
          <p className="info-panel-copy">
            Splitting a song takes more memory than a phone will give. Your songs play here — add
            them on a desktop, or import stems you already have.
          </p>
        </section>

        {loading ? null : isEmpty ? (
          <EmptyLibrary onChooseFile={openPicker} busy={processing} />
        ) : (
          <>
            {alerts.map(sep => (
              <AlertCard key={sep.id} sep={sep} actions={separationActions} />
            ))}

            {running.map(sep => (
              <RunningPanel key={sep.id} sep={sep} actions={separationActions} />
            ))}

            {queued.length > 0 && (
              <section className="library-section">
                <div className="library-section-head">
                  <span className="legend">Up next</span>
                  <span className="library-section-meta mono">
                    {queued.length} waiting · one at a time, on purpose
                  </span>
                </div>
                <ul className="queue-list">
                  {queued.map(sep => (
                    <QueuedRow
                      key={sep.id}
                      sep={sep}
                      separations={separations}
                      actions={separationActions}
                    />
                  ))}
                </ul>
              </section>
            )}

            {songs.length > 0 && (
              <section className="library-section">
                <div className="library-section-head">
                  <span className="legend">Your songs</span>
                  <span className="library-section-meta mono">
                    {songs.length} · {formatDiskSize(diskBytes)} on disk
                  </span>
                </div>
                <ul className="song-list">
                  {songs.map(song => (
                    <SongRow
                      key={song.id}
                      song={song}
                      onOpen={openSong}
                      onRename={renameSong}
                      onDelete={handleDeleteSong}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-overlay-card">
              <span className="icon" aria-hidden="true">download_for_offline</span>
              <span className="drop-overlay-title">Drop to add this song</span>
              <span className="legend legend--sm">One file to split · four to import as stems</span>
            </div>
          </div>
        )}
      </main>

      {/* Design 2d, pinned above the footer. Amber and always present on a
          phone, not dismissible, because the thing it prevents is losing a
          whole library: an iOS browser clears stored audio after a week
          idle, and an installed Gerson keeps it. */}
      <aside className="install-prompt mobile-only">
        <span className="icon" aria-hidden="true">add_to_home_screen</span>
        <p>Add Gerson to your Home Screen so your songs survive.</p>
      </aside>

      <LibraryFooter running={running} queued={queued} />

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

// The status footer. Quiet when nothing is running, and it says so — an
// empty footer would read as a missing one. When a Separation is running it
// takes the lime dot and names the count, plus the one thing about it the
// user has to know before closing the tab.
function LibraryFooter({ running, queued }: { running: Separation[]; queued: Separation[] }) {
  const active = running.length > 0;

  return (
    <footer className={`app-footer${active ? ' app-footer--active' : ''}`}>
      {active ? (
        <>
          <span className="job-dot" aria-hidden="true" />
          <span className="legend">
            {running.length} separation running{queued.length > 0 ? ` · ${queued.length} queued` : ''}
          </span>
          <span className="app-footer-note">
            A separation can't resume — closing this tab starts it over.
          </span>
        </>
      ) : (
        <>
          <span className="icon app-footer-check" aria-hidden="true">check_circle</span>
          <span className="legend">No separations running</span>
          <span className="app-footer-note mono">Works offline · Export is the only backup</span>
        </>
      )}
    </footer>
  );
}
