import { useState } from 'react';
import { ROLES, type Role } from '../domain/types.ts';
import type { MappingCandidate } from '../import/importSet.ts';

interface ImportMappingModalProps {
  title: string;
  candidates: MappingCandidate[];
  submitting: boolean;
  error: string | null;
  onConfirm: (assignment: Record<string, Role>) => void;
  onCancel: () => void;
}

// Matches the "Xm Ys" convention Library.tsx's SongRow already uses for a
// Song's duration — the same field shown in the same app, formatted once.
function formatDuration(durationSec: number): string {
  return `${Math.round(durationSec / 60)}m ${Math.round(durationSec % 60)}s`;
}

type Assignment = Record<string, Role | ''>;

function initialAssignment(candidates: MappingCandidate[]): Assignment {
  return Object.fromEntries(candidates.map(c => [c.name, c.prefillRole ?? '']));
}

/**
 * The explicit four-dropdown role mapping (§10.4), shown only for untagged
 * sets. Nothing proceeds until all four Roles are assigned and distinct.
 * A filename prefill is a suggestion the user commits to, never an
 * auto-accept — so a still-suggested row stays visibly marked until the
 * user interacts with it.
 */
export function ImportMappingModal({ title, candidates, submitting, error, onConfirm, onCancel }: ImportMappingModalProps) {
  const [assignment, setAssignment] = useState<Assignment>(() => initialAssignment(candidates));

  const values = candidates.map(c => assignment[c.name]);
  const allAssigned = values.every(v => v !== '');
  const allDistinct = new Set(values).size === values.length;
  const canConfirm = allAssigned && allDistinct && !submitting;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(assignment as Record<string, Role>);
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Assign stem roles">
        <h2 className="modal-title">Which stem is which?</h2>
        <p className="modal-subtitle">
          "{title}" doesn't carry role tags — assign one to each of the four files before it can be
          imported.
        </p>

        <ul className="import-mapping-list">
          {candidates.map(candidate => {
            const value = assignment[candidate.name];
            const isSuggested = candidate.prefillRole !== null && value === candidate.prefillRole;
            return (
              <li key={candidate.name} className="import-mapping-row">
                <div className="import-mapping-file">
                  <span className="import-mapping-name">{candidate.name}</span>
                  <span className="import-mapping-duration">{formatDuration(candidate.durationSec)}</span>
                </div>
                <div className="import-mapping-role">
                  <select
                    aria-label={`Role for ${candidate.name}`}
                    value={value}
                    onChange={e => setAssignment(a => ({ ...a, [candidate.name]: e.target.value as Role | '' }))}
                  >
                    <option value="">Choose a role…</option>
                    {ROLES.map(role => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  {isSuggested && <span className="import-mapping-suggested">suggested</span>}
                </div>
              </li>
            );
          })}
        </ul>

        {error && <p className="import-mapping-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            {submitting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
