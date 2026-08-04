import { useState, useEffect, useCallback } from 'react';
import type { Separation, Song } from '../domain/types.ts';
import { getAllSeparations, getAllSongs } from '../storage/db.ts';
import { subscribe, addToQueue, cancel, dismiss, retry, resume, reorder } from '../separation/engine.ts';

export interface LibraryState {
  separations: Separation[];
  songs: Song[];
  loading: boolean;
  error: Error | null;
}

export function useLibrary() {
  const [state, setState] = useState<LibraryState>({
    separations: [],
    songs: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    Promise.all([getAllSeparations(), getAllSongs()])
      .then(([separations, songs]) => {
        setState({ separations, songs, loading: false, error: null });
      })
      .catch((e: unknown) => {
        setState(s => ({ ...s, loading: false, error: e instanceof Error ? e : new Error(String(e)) }));
      });

    const unsub = subscribe((event) => {
      setState(s => {
        switch (event.type) {
          case 'progress':
            return {
              ...s,
              separations: s.separations.map(sep =>
                sep.id === event.id
                  ? { ...sep, status: 'running' as const, progress: event.progress }
                  : sep
              ),
            };
          case 'done':
            return {
              ...s,
              separations: s.separations.filter(sep => sep.id !== event.id),
              songs: [...s.songs, event.song],
            };
          case 'failed':
            return {
              ...s,
              separations: s.separations.map(sep =>
                sep.id === event.separation.id ? event.separation : sep
              ),
            };
          case 'updated':
            return {
              ...s,
              separations: s.separations.map(sep =>
                sep.id === event.separation.id ? event.separation : sep
              ),
            };
          case 'removed':
            return {
              ...s,
              separations: s.separations.filter(sep => sep.id !== event.id),
            };
        }
      });
    });

    return unsub;
  }, []);

  const addSeparation = useCallback((sep: Separation) => {
    setState(s => ({ ...s, separations: [...s.separations, sep] }));
    addToQueue();
  }, []);

  const cancelSeparation = useCallback((id: string) => { void cancel(id); }, []);
  const dismissSeparation = useCallback((id: string) => { void dismiss(id); }, []);
  const retrySeparation = useCallback((id: string) => { void retry(id); }, []);
  const resumeSeparation = useCallback((id: string) => { void resume(id); }, []);
  const reorderSeparation = useCallback((id: string, direction: 'up' | 'down') => {
    void reorder(id, direction);
  }, []);

  return {
    ...state,
    addSeparation,
    cancelSeparation,
    dismissSeparation,
    retrySeparation,
    resumeSeparation,
    reorderSeparation,
  };
}
