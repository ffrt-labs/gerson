/**
 * Filename-based Role prefill for the import mapping modal (§10.4, §6.2).
 * Filenames are never trusted for role — this only ever produces a visible,
 * editable suggestion, never an auto-accept. Prefill fires under one strict
 * condition: the four filenames must yield four distinct roles
 * unambiguously, or nothing is prefilled and all four dropdowns start
 * empty — half-guessing is worse than not guessing, because it produces a
 * form that looks already-correct.
 */

import type { Role } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';

// Covers our own export convention, Demucs CLI / Spleeter output, and the
// common third-party pack spellings. Not exhaustive by design — content-
// based role detection is a decided non-goal, and an over-eager keyword
// list just trades one kind of invisible guess for another.
const KEYWORDS: Record<Role, string[]> = {
  vocals: ['vocals', 'vocal', 'vox'],
  drums: ['drums', 'drum'],
  bass: ['bass'],
  other: ['other', 'instrumental', 'inst'],
};

// Roles whose keyword appears in `name`, case-insensitively. More than one
// entry means the filename is ambiguous between roles; zero means no match.
function matchingRoles(name: string): Role[] {
  const lower = name.toLowerCase();
  return ROLES.filter(role => KEYWORDS[role].some(kw => lower.includes(kw)));
}

/**
 * Prefill suggestions, one per input name in the same order — a matched
 * Role, or null for every entry when the four names don't yield an
 * unambiguous four-distinct-role match.
 */
export function prefillRoles(names: string[]): Array<Role | null> {
  const matches = names.map(matchingRoles);
  const none = names.map(() => null);

  if (!matches.every(m => m.length === 1)) return none;

  const roles = matches.map(m => m[0]);
  if (new Set(roles).size !== ROLES.length || roles.length !== ROLES.length) return none;

  return roles;
}
