import { useEffect, useState } from 'react';

// The width below which the Player switches to the mobile layout (design
// 2d). Kept in sync by hand with the `max-width: 700px` block in index.css:
// most of the switch is CSS, but a canvas height is a number the component
// has to pass, not a rule the stylesheet can apply.
export const COMPACT_MAX_WIDTH_PX = 700;

const QUERY = `(max-width: ${COMPACT_MAX_WIDTH_PX}px)`;

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setCompact(media.matches);
    // Re-read on subscribe: the width may have changed between the initial
    // state and this effect running.
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return compact;
}
