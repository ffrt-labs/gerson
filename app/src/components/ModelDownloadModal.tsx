import { useState } from 'react';
import { downloadModel, type ModelDownloadResult } from '../separation/model.ts';
import { MODEL_CONSENT_BODY, MODEL_CONSENT_TITLE, modelDownloadFailureAdvice } from '../separation/copy.ts';
import { formatMegabytes } from '../format/units.ts';

interface ModelDownloadModalProps {
  onReady: () => void;
  onCancel: () => void;
}

type Phase =
  | { kind: 'consent' }
  | { kind: 'downloading'; receivedBytes: number; totalBytes: number | null }
  | { kind: 'failed'; result: Extract<ModelDownloadResult, { ok: false }> };

// Gates the first separation on consent, then shows real byte progress for
// the download itself (spec §7.3, §8). A failure here is explicitly not
// fatal — it stays inside this modal and offers Retry, never implies the
// app itself is broken.
//
// The consent copy is verbatim from copy.ts. What the redesign adds is the
// inset line naming this as the only time Gerson uses the network: the
// promise is the product, so the one exception has to be stated where the
// user is being asked to allow it, not buried in a settings page.
export function ModelDownloadModal({ onReady, onCancel }: ModelDownloadModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'consent' });

  const startDownload = () => {
    setPhase({ kind: 'downloading', receivedBytes: 0, totalBytes: null });
    downloadModel((receivedBytes, totalBytes) => {
      setPhase(p => (p.kind === 'downloading' ? { kind: 'downloading', receivedBytes, totalBytes } : p));
    }).then(result => {
      if (result.ok) {
        onReady();
      } else {
        setPhase({ kind: 'failed', result });
      }
    });
  };

  return (
    <div className="modal-scrim" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Separation model download">
        {phase.kind === 'consent' && (
          <>
            <span className="modal-icon" aria-hidden="true">
              <span className="icon">cloud_download</span>
            </span>
            <h2 className="modal-title">{MODEL_CONSENT_TITLE}</h2>
            <p className="modal-copy">{MODEL_CONSENT_BODY}</p>
            <p className="modal-inset legend">The only time Gerson uses the network</p>
            <div className="modal-actions">
              <button type="button" className="btn btn--primary btn--primary-tap modal-action-grow" onClick={startDownload}>
                <span className="icon" aria-hidden="true">download</span>
                Download
              </button>
              <button type="button" className="btn btn--ghost btn--primary-tap" onClick={onCancel}>
                Not now
              </button>
            </div>
          </>
        )}

        {phase.kind === 'downloading' && (
          <>
            <span className="modal-icon" aria-hidden="true">
              <span className="icon">downloading</span>
            </span>
            <h2 className="modal-title">Getting the model</h2>
            <p className="modal-figure">
              <span className="modal-figure-value mono">{formatMegabytes(phase.receivedBytes)}</span>
              {/* Total size is not always advertised — with none, showing
                  received MB alone is honest where a fabricated total is not. */}
              <span className="modal-figure-unit">
                {phase.totalBytes ? `MB of ${formatMegabytes(phase.totalBytes)} MB` : 'MB so far'}
              </span>
            </p>
            <div
              className={`progress${phase.totalBytes ? '' : ' progress--indeterminate'}`}
              role="progressbar"
              aria-valuenow={phase.totalBytes ? phase.receivedBytes : undefined}
              aria-valuemin={0}
              aria-valuemax={phase.totalBytes ?? undefined}
            >
              <span
                style={phase.totalBytes ? { width: `${(phase.receivedBytes / phase.totalBytes) * 100}%` } : undefined}
              />
            </div>
            <p className="modal-copy">
              Once it's here it stays here. Gerson won't ask for it again.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost btn--primary-tap" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.kind === 'failed' && (
          <>
            <span className="modal-icon modal-icon--danger" aria-hidden="true">
              <span className="icon">error</span>
            </span>
            <h2 className="modal-title">Model download interrupted</h2>
            <p className="modal-copy">{modelDownloadFailureAdvice(phase.result.reason)}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn--primary btn--primary-tap modal-action-grow" onClick={startDownload}>
                <span className="icon" aria-hidden="true">refresh</span>
                Retry
              </button>
              <button type="button" className="btn btn--ghost btn--primary-tap" onClick={onCancel}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
