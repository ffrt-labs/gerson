import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar';
import { getSong } from '../storage/db.ts';
import { createTransport, type Transport } from '../playback/transport.ts';
import { songStemLoader } from '../playback/loadSong.ts';
import type { Song } from '../domain/types.ts';

type LoadStatus = 'loading' | 'ready' | 'error';

interface Session {
  transport: Transport;
  audioContext: AudioContext;
}

// Keyed by songId, so a stale result from a previous Song reads as loading
// rather than flashing the old Song's status — same convention as `result`
// above for the Song fetch itself.
interface LoadState {
  songId: string;
  status: LoadStatus;
  error: string | null;
}

async function releaseSession(session: Session): Promise<void> {
  await session.transport.dispose();
  await session.audioContext.close();
}

export function Player() {
  const { id } = useParams<{ id: string }>();
  // Keyed by id, so a stale result from a previous id reads as loading
  // rather than flashing the old Song.
  const [result, setResult] = useState<{ id: string; song: Song | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getSong(id).then(found => {
      if (!cancelled) setResult({ id, song: found ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // undefined = loading (or stale for a previous id), null = Song not found.
  const song = result && result.id === id ? result.song : undefined;

  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seekInput, setSeekInput] = useState('0');
  const sessionRef = useRef<Session | null>(null);

  // A stale result from a previous Song reads as 'loading', not an error
  // state, until proven otherwise.
  const currentLoad = song && loadState?.songId === song.id ? loadState : null;
  const loadStatus: LoadStatus = currentLoad?.status ?? 'loading';
  const loadError = currentLoad?.error ?? null;

  // Loads the four Stems into a fresh transport whenever the resolved Song
  // changes. The four Stems load sequentially, decoded straight to
  // transferable Float32Arrays and handed to the stretcher one at a time
  // (§4.4) — that interleaving lives in createTransport/loadSongStem, this
  // effect just owns the session's lifetime.
  useEffect(() => {
    if (!song) return;
    let cancelled = false;
    const songId = song.id;

    const audioContext = new AudioContext();
    createTransport(audioContext, songStemLoader(song))
      .then(transport => {
        if (cancelled) {
          void releaseSession({ transport, audioContext });
          return;
        }
        sessionRef.current = { transport, audioContext };
        setPlaying(false);
        setLoadState({ songId, status: 'ready', error: null });
      })
      .catch((e: unknown) => {
        // createTransport rejecting mid-load (e.g. the 3rd stem fails to
        // decode) leaves no Transport to dispose — but any nodes it already
        // built and fed belong to this AudioContext, so closing it tears
        // the whole graph down regardless of how far setup got.
        void audioContext.close();
        if (cancelled) return;
        setLoadState({ songId, status: 'error', error: e instanceof Error ? e.message : String(e) });
      });

    // Leaving the Player (or opening a different Song) releases this
    // Song's buffers — reopening repeatedly must not grow memory unbounded.
    return () => {
      cancelled = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void releaseSession(session);
    };
  }, [song]);

  const play = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // Resume here, inside the click handler, so a context created earlier
    // (outside any user gesture) still satisfies the autoplay policy.
    void session.audioContext.resume();
    session.transport.play();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    sessionRef.current?.transport.pause();
    setPlaying(false);
  }, []);

  const seek = useCallback(() => {
    const seconds = Number(seekInput);
    if (Number.isFinite(seconds)) sessionRef.current?.transport.seek(seconds);
  }, [seekInput]);

  return (
    <div className="surface">
      <header className="surface-header">
        <Link to="/" className="back-link">← Library</Link>
        <h1>{song ? song.title : 'Player'}</h1>
      </header>
      <main className="surface-main player-main">
        {!id ? (
          <p className="empty-state">No song open.</p>
        ) : song === undefined ? null : song === null ? (
          <p className="empty-state">Song not found.</p>
        ) : loadStatus === 'loading' ? (
          <p className="empty-state">Loading…</p>
        ) : loadStatus === 'error' ? (
          <p className="empty-state">{loadError}</p>
        ) : (
          <div className="player-transport">
            <button onClick={play} disabled={playing}>Play</button>
            <button onClick={pause} disabled={!playing}>Pause</button>
            <label>
              Seek to (s):{' '}
              <input
                type="number"
                value={seekInput}
                onChange={e => setSeekInput(e.target.value)}
              />
            </label>
            <button onClick={seek}>Seek</button>
          </div>
        )}
      </main>
      <JobStatusBar />
    </div>
  );
}
