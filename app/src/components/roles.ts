import type { Role } from '../domain/types.ts';

export const ROLE_LABELS: Record<Role, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  other: 'Other',
};

// Material Symbols glyph names, from the handoff's icon list. "other" is
// the catch-all for everything not vocals/drums/bass — including guitar and
// keys — so it takes the keyboard glyph rather than any one instrument.
export const ROLE_ICONS: Record<Role, string> = {
  vocals: 'mic',
  drums: 'album',
  bass: 'graphic_eq',
  other: 'piano',
};
