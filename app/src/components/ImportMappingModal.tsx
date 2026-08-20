import { useState } from 'react';
import { ROLES, type Role } from '../domain/types.ts';
import type { MappingCandidate } from '../import/importSet.ts';
import { formatClock } from '../format/units.ts';
import { ROLE_ICONS, ROLE_LABELS } from './roles.ts';

interface ImportMappingModalProps {
  title: string;
  candidates: MappingCandidate[];
  submitting: boolean;
  error: string | null;
  onConfirm: (assignment: Record<string, Role>) => void;
  onCancel: () => void;
}

type Assignment = Record<string, Role | ''>;

function initialAssignment(candidates: MappingCandidate[]): Assignment {
  return Object.fromEntries(candidates.map(c => [c.name, c.prefillRole ?? '']));
}

/**
 * The explicit four-dropdown role mapping (§10.4), shown only for untagged
 * sets. Nothing proceeds until all four Roles are assigned and distinct.
 * A filename prefill is a suggestion the user commits to, never an
 * auto-accept — so a still-suggested row stays visibly marked (an amber
 * GUESS badge) until the user interacts with it.
 *
 * The validation note names what is actually wrong rather than just
 * disabling Import: a disabled button with no sentence beside it is a
 * puzzle, and this modal appears exactly when the user has no idea which
 * file is which.
 */
export function ImportMappingModal({ title, candidates, submitting, error, onConfirm, onCancel }: ImportMappingModalProps) {
  const [assignment, setAssignment] = useState<Assignment>(() => initialAssignment(candidates));

  const values = candidates.map(c => assignment[c.name]);
  const assignedCount = values.filter(v => v !== '').length;
  const allAssigned = assignedCount === values.length;
  const allDistinct = new Set(values).size === values.length;
  const canConfirm = allAssigned && allDistinct && !submitting;

  const validation = !allAssigned
    ? `${values.length - assignedCount} role${values.length - assignedCount === 1 ? '' : 's'} left to assign — each file needs a different one.`
    : !allDistinct
      ? 'Two files share a role — each file needs a different one.'
      : null;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(assignment as Record<string, Role>);
  };

  return (
    <div className="modal-scrim" role="presentation">
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Assign stem roles">
        <h2 className="modal-title">Which stem is which?</h2>
        <p className="modal-copy">
          "{title}" doesn't carry role tags — assign one to each of the four files before it can be
          imported.
        </p>

        <ul className="mapping-list">
          {candidates.map(candidate => {
            const value = assignment[candidate.name];
            const isGuess = candidate.prefillRole !== null && value === candidate.prefillRole;
            return (
              <li
                key={candidate.name}
                className={`mapping-row${value === '' ? ' mapping-row--unassigned' : ''}`}
              >
                <div className="mapping-row-file">
                  <span className="mapping-row-name">{candidate.name}</span>
                  <span className="mapping-row-duration mono">{formatClock(candidate.durationSec)}</span>
                </div>
                {isGuess && <span className="badge badge--loop">Guess</span>}
                <div className="mapping-row-select">
                  {value !== '' && (
                    <span className="icon" aria-hidden="true">{ROLE_ICONS[value]}</span>
                  )}
                  <select
                    aria-label={`Role for ${candidate.name}`}
                    value={value}
                    onChange={e => setAssignment(a => ({ ...a, [candidate.name]: e.target.value as Role | '' }))}
                  >
                    <option value="">Pick a role</option>
                    {ROLES.map(role => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  <span className="icon" aria-hidden="true">expand_more</span>
                </div>
              </li>
            );
          })}
        </ul>

        {validation && <p className="alert-note alert-note--loop">{validation}</p>}
        {error && <p className="alert-note alert-note--danger">{error}</p>}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--primary btn--primary-tap modal-action-grow"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {submitting ? 'Importing…' : 'Import'}
          </button>
          <button type="button" className="btn btn--ghost btn--primary-tap" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
