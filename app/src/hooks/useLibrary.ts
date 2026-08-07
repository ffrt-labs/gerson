import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Separation, Song } from '../domain/types.ts';
import { getAllSeparations, getAllSongs } from '../storage/db.ts';
import { subscribe, addToQueue, cancel, dismiss, retry, resume, reorder } from '../separation/engine.ts';
import { renameSong as renameSongEngine, deleteSong as deleteSongEngine } from '../library/engine.ts';
import { sortSongsNewestFirst } from '../library/sort.ts';

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

  // Lands a freshly-imported Song (§6.2) in library state directly — there
  // is no Separation this went through, so the engine's 'done' event never
  // fires for it.
  const addSong = useCallback((song: Song) => {
    setState(s => ({ ...s, songs: [...s.songs, song] }));
  }, []);

  const cancelSeparation = useCallback((id: string) => { void cancel(id); }, []);
  const dismissSeparation = useCallback((id: string) => { void dismiss(id); }, []);
  const retrySeparation = useCallback((id: string) => { void retry(id); }, []);
  const resumeSeparation = useCallback((id: string) => { void resume(id); }, []);
  const reorderSeparation = useCallback((id: string, direction: 'up' | 'down') => {
    void reorder(id, direction);
  }, []);

  const renameSong = useCallback(async (id: string, title: string) => {
    const updated = await renameSongEngine(id, title);
    if (updated) {
      setState(s => ({ ...s, songs: s.songs.map(song => (song.id === id ? updated : song)) }));
    }
  }, []);

  const deleteSong = useCallback(async (id: string) => {
    await deleteSongEngine(id);
    setState(s => ({ ...s, songs: s.songs.filter(song => song.id !== id) }));
  }, []);

  const songs = useMemo(() => sortSongsNewestFirst(state.songs), [state.songs]);

  return {
    ...state,
    songs,
    addSeparation,
    addSong,
    cancelSeparation,
    dismissSeparation,
    retrySeparation,
    resumeSeparation,
    reorderSeparation,
    renameSong,
    deleteSong,
  };
}
