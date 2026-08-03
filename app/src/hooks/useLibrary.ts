import { useState, useEffect, useCallback } from 'react';
import type { Separation, Song } from '../domain/types.ts';
import { getAllSeparations, getAllSongs } from '../storage/db.ts';

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
  }, []);

  const addSeparation = useCallback((sep: Separation) => {
    setState(s => ({ ...s, separations: [...s.separations, sep] }));
  }, []);

  return { ...state, addSeparation };
}
