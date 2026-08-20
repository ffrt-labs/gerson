import { useCallback, useState } from 'react';
import type { PracticeState, Role, Song } from '../domain/types.ts';
import { exportStems, type ExportFormat } from '../export/exportStems.ts';
import { exportMix } from '../export/exportMix.ts';
import { deliverFile, deliverStems, isUserCancelled } from '../export/delivery.ts';
import { sanitizeForFilename } from '../export/filename.ts';
import { mixSummaryChips } from '../export/summary.ts';
import { songBytes } from '../library/disk.ts';
import { formatDiskSize, formatRate } from '../format/units.ts';

interface ExportSheetProps {
  song: Song;
  practice: PracticeState;
  solo: Record<Role, boolean>;
  onClose: () => void;
}

type Job = 'stems' | 'mix';
type Status =
  | { kind: 'idle' }
  | { kind: 'exporting'; job: Job }
  | { kind: 'error'; message: string };

function FormatControl({
  name,
  format,
  onChange,
}: {
  name: string;
  format: ExportFormat;
  onChange: (format: ExportFormat) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={`${name} format`}>
      <button type="button" aria-pressed={format === 'flac'} onClick={() => onChange('flac')}>
        FLAC
      </button>
      <button type="button" aria-pressed={format === 'wav'} onClick={() => onChange('wav')}>
        WAV
      </button>
    </div>
  );
}

// FLAC is roughly this fraction of the WAV it came from for the sort of
// material Gerson handles. Both are labelled "about" in the UI: an exact
// figure would mean encoding the whole Song to find out.
const FLAC_RATIO = 0.6;

/**
 * The export sheet (design 2a): both exports in one place, and the
 * difference between them made the point rather than left to be inferred.
 *
 * Stems is neutral — four files exactly as separated, ignoring the whole
 * Practice state. Mix is what you hear, and its chips name every engaged
 * state that will be baked into the file. The old UI ran both as two
 * identical-looking control blocks stacked under the stem rows, with
 * nothing saying that one of them honoured mute and solo and the other did
 * not.
 *
 * Exporting never touches the Transport: playback, tempo, loop and the
 * playhead stay exactly where they were.
 */
export function ExportSheet({ song, practice, solo, onClose }: ExportSheetProps) {
  const [stemsFormat, setStemsFormat] = useState<ExportFormat>('flac');
  const [mixFormat, setMixFormat] = useState<ExportFormat>('flac');
  // Off by default (§6.1 acceptance): with it off the mix renders at 1×
  // regardless of the Practice state's stored tempo.
  const [applyTempo, setApplyTempo] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const run = useCallback((job: Job, work: () => Promise<unknown>) => {
    setStatus({ kind: 'exporting', job });
    work()
      .then(() => setStatus({ kind: 'idle' }))
      .catch((e: unknown) => {
        // Cancelling the save dialog is a decision, not a failure.
        if (isUserCancelled(e)) { setStatus({ kind: 'idle' }); return; }
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  const handleExportStems = useCallback(() => {
    run('stems', () =>
      exportStems(song, stemsFormat).then(files =>
        deliverStems(files, `${sanitizeForFilename(song.title)}.zip`),
      ),
    );
  }, [run, song, stemsFormat]);

  const handleExportMix = useCallback(() => {
    run('mix', () =>
      exportMix(song, practice, solo, mixFormat, applyTempo).then(file => deliverFile(file)),
    );
  }, [run, song, practice, solo, mixFormat, applyTempo]);

  const busy = status.kind === 'exporting';
  const chips = mixSummaryChips(practice, solo);

  // Both estimates come off the stored stem bytes, which are already FLAC
  // on disk — a WAV export inflates, a FLAC one is roughly a copy.
  const stemsBytes = songBytes(song) - song.recording.bytes;
  const stemsEstimate = stemsFormat === 'flac' ? stemsBytes : stemsBytes / FLAC_RATIO;
  // The mix is one file where the stems are four, of the same length and
  // format — so a quarter, near enough for a figure the UI already labels
  // "about". Summing four stems does not make the result four times as
  // hard to encode.
  const mixEstimate = stemsEstimate / 4;

  return (
    <div className="sheet-scrim" role="presentation" onClick={onClose}>
      <aside
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Export ${song.title}`}
        onClick={e => e.stopPropagation()}
      >
        <header className="sheet-header">
          <span className="icon" aria-hidden="true">download</span>
          <div className="sheet-header-text">
            <h2 className="sheet-title">Export</h2>
            <p className="sheet-subtitle">{song.title}</p>
          </div>
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Close export" onClick={onClose}>
            <span className="icon" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="sheet-body">
          <section className="export-card">
            <span className="legend">4 files · zip</span>
            <h3 className="export-card-title">Stems</h3>
            <p className="export-card-copy">
              One file per stem, exactly as separated. Gain, mute, solo, loop and tempo are ignored.
            </p>
            <FormatControl name="Stems" format={stemsFormat} onChange={setStemsFormat} />
            {stemsFormat === 'wav' && (
              <p className="export-card-note">
                WAV stems re-import unlabelled — you'll be asked which file is which. FLAC keeps the labels.
              </p>
            )}
            <p className="export-card-estimate mono">about {formatDiskSize(stemsEstimate)}</p>
            <button
              type="button"
              className="btn btn--secondary btn--primary-tap export-card-action"
              onClick={handleExportStems}
              disabled={busy}
            >
              <span className="icon" aria-hidden="true">folder_zip</span>
              {status.kind === 'exporting' && status.job === 'stems' ? 'Exporting…' : 'Export stems'}
            </button>
          </section>

          <section className="export-card export-card--mix">
            <span className="legend">What you hear</span>
            <h3 className="export-card-title">Mix</h3>
            <p className="export-card-copy">
              One file, rendered the way it sounds right now.
            </p>
            {chips.length > 0 ? (
              <ul className="export-chips">
                {chips.map(chip => (
                  <li
                    key={chip.label}
                    className={`badge ${chip.kind === 'solo' ? 'badge--accent' : 'badge--loop'}`}
                  >
                    {chip.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="export-card-note">Nothing is muted, soloed or looping — this is the plain mix.</p>
            )}
            <FormatControl name="Mix" format={mixFormat} onChange={setMixFormat} />
            {mixFormat === 'wav' && (
              <p className="export-card-note">WAV is uncompressed — a bigger file, identical audio.</p>
            )}

            <div className="export-tempo">
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={applyTempo}
                aria-label={`Render at ${formatRate(practice.tempo)} too`}
                onClick={() => setApplyTempo(v => !v)}
              />
              <div className="export-tempo-text">
                <span className="export-tempo-label">Render at {formatRate(practice.tempo)} too</span>
                <p className="export-card-note">
                  Off renders at full speed. On goes through the stretcher, which takes longer.
                </p>
              </div>
            </div>

            <p className="export-card-estimate mono">about {formatDiskSize(mixEstimate)}</p>
            <button
              type="button"
              className="btn btn--primary btn--primary-tap export-card-action"
              onClick={handleExportMix}
              disabled={busy}
            >
              <span className="icon" aria-hidden="true">download</span>
              {status.kind === 'exporting' && status.job === 'mix' ? 'Exporting…' : 'Export mix'}
            </button>
          </section>

          {busy && (
            <div className="export-progress">
              {/* Indeterminate on purpose: exportStems and exportMix report
                  no progress, and a bar that invents a percentage for a
                  multi-second encode teaches the user to distrust the next
                  one that is real. */}
              <div className="progress progress--indeterminate" role="progressbar" aria-label="Exporting">
                <span />
              </div>
              <p>Playback keeps going — this doesn't touch it.</p>
            </div>
          )}
          {status.kind === 'error' && <p className="alert-note alert-note--danger">{status.message}</p>}
        </div>

        <footer className="sheet-footer">
          <span className="icon" aria-hidden="true">shield</span>
          <p>Export is the only backup. Nothing here is stored anywhere but this device.</p>
        </footer>
      </aside>
    </div>
  );
}
