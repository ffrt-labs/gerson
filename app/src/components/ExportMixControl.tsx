import { useCallback, useState } from 'react';
import type { PracticeState, Role, Song } from '../domain/types.ts';
import { exportMix } from '../export/exportMix.ts';
import { deliverFile, isUserCancelled } from '../export/delivery.ts';
import type { ExportFormat } from '../export/exportStems.ts';

interface ExportMixControlProps {
  song: Song;
  practice: PracticeState;
  solo: Record<Role, boolean>;
}

type ExportStatus = 'idle' | 'exporting' | 'error';

function formatRate(rate: number): string {
  return `${rate.toFixed(2)}×`;
}

/**
 * "Export mix" (§6.1): one file, honouring gain/mute/solo and the loop
 * region — a rendering of what you are hearing, not the neutral stem
 * export. Reads the live Practice state and solo passed down from Player,
 * but works entirely from stored stems and never touches the Transport —
 * exporting cannot disturb playback (tempo, loop and the playhead stay
 * exactly where they were).
 */
export function ExportMixControl({ song, practice, solo }: ExportMixControlProps) {
  const [format, setFormat] = useState<ExportFormat>('flac');
  // Off by default (§6.1 acceptance): with it off the mix renders at 1×
  // regardless of the Practice state's stored tempo.
  const [applyTempo, setApplyTempo] = useState(false);
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    setStatus('exporting');
    setError(null);
    exportMix(song, practice, solo, format, applyTempo)
      .then(file => deliverFile(file))
      .then(() => setStatus('idle'))
      .catch((e: unknown) => {
        if (isUserCancelled(e)) { setStatus('idle'); return; }
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [song, practice, solo, format, applyTempo]);

  return (
    <div className="player-export">
      <span className="player-export-label">Export mix</span>
      <div className="player-export-format" role="radiogroup" aria-label="Export mix format">
        <label className="player-export-format-option">
          <input
            type="radio"
            name="export-mix-format"
            value="flac"
            checked={format === 'flac'}
            onChange={() => setFormat('flac')}
          />
          FLAC
        </label>
        <label className="player-export-format-option">
          <input
            type="radio"
            name="export-mix-format"
            value="wav"
            checked={format === 'wav'}
            onChange={() => setFormat('wav')}
          />
          WAV
        </label>
      </div>
      <label className="player-export-apply-tempo">
        <input
          type="checkbox"
          checked={applyTempo}
          onChange={e => setApplyTempo(e.target.checked)}
        />
        Apply tempo ({formatRate(practice.tempo)}) — renders through the stretcher, off renders at 1×
      </label>
      <button
        type="button"
        className="player-export-button"
        onClick={handleExport}
        disabled={status === 'exporting'}
      >
        {status === 'exporting' ? 'Exporting…' : 'Export mix'}
      </button>
      {status === 'error' && error && <p className="player-export-error">{error}</p>}
    </div>
  );
}
