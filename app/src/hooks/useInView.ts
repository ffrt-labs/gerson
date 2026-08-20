import { useEffect, useRef, useState, type RefObject } from 'react';

// True once the element has been scrolled into view, and true forever after
// — this gates work that is expensive to start and pointless to undo (a
// library row reading its Song's peaks off disk). Latching rather than
// tracking visibility means scrolling back and forth never re-reads.
export function useInView<T extends HTMLElement>(rootMargin = '200px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, rootMargin]);

  return [ref, seen];
}
