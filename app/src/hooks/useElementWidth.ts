import { useEffect, useRef, useState, type RefObject } from 'react';

// Tracks a DOM element's CSS pixel width via ResizeObserver — the fit-the-song
// viewport (§5.2) is sized to its container, not to a fixed layout constant.
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    setWidth(el.clientWidth);
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
