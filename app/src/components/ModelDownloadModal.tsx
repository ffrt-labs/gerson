import { useState } from 'react';
import { downloadModel, type ModelDownloadResult } from '../separation/model.ts';
import { MODEL_CONSENT_BODY, MODEL_CONSENT_TITLE, modelDownloadFailureAdvice } from '../separation/copy.ts';

interface ModelDownloadModalProps {
  onReady: () => void;
  onCancel: () => void;
}

type Phase =
  | { kind: 'consent' }
  | { kind: 'downloading'; receivedBytes: number; totalBytes: number | null }
  | { kind: 'failed'; result: Extract<ModelDownloadResult, { ok: false }> };

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Gates the first separation on consent, then shows real byte progress for
// the download itself (spec §7.3, §8). A failure here is explicitly not
// fatal — it stays inside this modal and offers Retry, never implies the
// app itself is broken.
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
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Separation model download">
        {phase.kind === 'consent' && (
          <>
            <h2 className="modal-title">{MODEL_CONSENT_TITLE}</h2>
            <p className="modal-subtitle">{MODEL_CONSENT_BODY}</p>
            <div className="modal-actions">
              <button type="button" onClick={onCancel}>Not now</button>
              <button type="button" onClick={startDownload}>Download</button>
            </div>
          </>
        )}

        {phase.kind === 'downloading' && (
          <>
            <h2 className="modal-title">Downloading the separation model…</h2>
            <p className="modal-subtitle">
              {phase.totalBytes
                ? `${formatMB(phase.receivedBytes)} of ${formatMB(phase.totalBytes)}`
                : formatMB(phase.receivedBytes)}
            </p>
            <progress
              className="model-download-progress"
              value={phase.totalBytes ? phase.receivedBytes : undefined}
              max={phase.totalBytes ?? undefined}
            />
          </>
        )}

        {phase.kind === 'failed' && (
          <>
            <h2 className="modal-title">Model download interrupted</h2>
            <p className="modal-subtitle">{modelDownloadFailureAdvice(phase.result.reason)}</p>
            <div className="modal-actions">
              <button type="button" onClick={onCancel}>Not now</button>
              <button type="button" onClick={startDownload}>Retry</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
