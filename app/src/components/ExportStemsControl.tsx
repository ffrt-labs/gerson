import { useCallback, useState } from 'react';
import type { Song } from '../domain/types.ts';
import { exportStems, type ExportFormat } from '../export/exportStems.ts';
import { deliverStems } from '../export/delivery.ts';
import { sanitizeForFilename } from '../export/filename.ts';

interface ExportStemsControlProps {
  song: Song;
}

type ExportStatus = 'idle' | 'exporting' | 'error';

// showSaveFilePicker rejects with AbortError when the user cancels the save
// dialog — a normal outcome, not a failure worth surfacing as an error.
function isUserCancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * "Export stems" (§6.1): always neutral — four files, one per Role,
 * ignoring gain/mute/solo/loop/tempo — so this only ever needs the Song
 * itself, never the live Transport.
 */
export function ExportStemsControl({ song }: ExportStemsControlProps) {
  const [format, setFormat] = useState<ExportFormat>('flac');
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    setStatus('exporting');
    setError(null);
    exportStems(song, format)
      .then(files => deliverStems(files, `${sanitizeForFilename(song.title)}.zip`))
      .then(() => setStatus('idle'))
      .catch((e: unknown) => {
        if (isUserCancelled(e)) { setStatus('idle'); return; }
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [song, format]);

  return (
    <div className="player-export">
      <span className="player-export-label">Export stems</span>
      <div className="player-export-format" role="radiogroup" aria-label="Export format">
        <label className="player-export-format-option">
          <input
            type="radio"
            name="export-format"
            value="flac"
            checked={format === 'flac'}
            onChange={() => setFormat('flac')}
          />
          FLAC
        </label>
        <label className="player-export-format-option">
          <input
            type="radio"
            name="export-format"
            value="wav"
            checked={format === 'wav'}
            onChange={() => setFormat('wav')}
          />
          WAV
        </label>
      </div>
      {format === 'wav' && (
        <p className="player-export-caveat">WAV stems re-import through manual role mapping.</p>
      )}
      <button
        type="button"
        className="player-export-button"
        onClick={handleExport}
        disabled={status === 'exporting'}
      >
        {status === 'exporting' ? 'Exporting…' : 'Export stems'}
      </button>
      {status === 'error' && error && <p className="player-export-error">{error}</p>}
    </div>
  );
}
