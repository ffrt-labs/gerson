import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JobStatusBar } from '../components/JobStatusBar';
import { getSong } from '../storage/db.ts';
import { savePractice } from '../library/engine.ts';
import { createTransport, type Transport } from '../playback/transport.ts';
import { songStemLoader } from '../playback/loadSong.ts';
import { loadSongPeaks } from '../waveform/loadPeaks.ts';
import { WaveformStack } from '../components/WaveformStack.tsx';
import { ROLES, defaultPracticeState, type PracticeState, type Role, type Song } from '../domain/types.ts';

const ROLE_LABELS: Record<Role, string> = { vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other' };
const NO_SOLO: Record<Role, boolean> = { vocals: false, drums: false, bass: false, other: false };

function withStemPatch(practice: PracticeState, role: Role, patch: Partial<PracticeState['stems'][Role]>): PracticeState {
  return { ...practice, stems: { ...practice.stems, [role]: { ...practice.stems[role], ...patch } } };
}

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

const MIN_RATE = 0.5;
const MAX_RATE = 2;

const MIN_GAIN = 0;
const MAX_GAIN = 1.5;

function formatRate(rate: number): string {
  return `${rate.toFixed(2)}×`;
}

function formatGain(gain: number): string {
  return gain.toFixed(2);
}

function formatPosition(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(2)}s`;
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
  const [practice, setPractice] = useState<PracticeState>(defaultPracticeState());
  // Solo is a momentary gesture (never persisted) — always off on open.
  const [solo, setSolo] = useState<Record<Role, boolean>>(NO_SOLO);
  const [position, setPosition] = useState(0);
  const [peaks, setPeaks] = useState<Record<Role, Int8Array> | null>(null);
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
      .then(async transport => {
        if (cancelled) {
          void releaseSession({ transport, audioContext });
          return;
        }
        sessionRef.current = { transport, audioContext };

        // Reopening a Song applies its saved Practice state (tempo,
        // per-stem gain/mute) live, but never the momentary gestures —
        // solo is off and the playhead sits at 0, or at the loop start
        // when a loop is set.
        transport.setRate(song.practice.tempo);
        for (const role of ROLES) {
          transport.setGain(role, song.practice.stems[role].gain);
          transport.setMuted(role, song.practice.stems[role].muted);
        }
        const startAt = song.practice.loop?.startSec ?? 0;
        if (startAt > 0) transport.seek(startAt);

        // Peaks are read only now, not earlier: createTransport just ran
        // loadSongStem for every Role, and that's the repair path (§3.4)
        // that guarantees this Song's peaks are valid on disk. Reading
        // any sooner risks racing that repair's own write.
        const loadedPeaks = await Promise.all(ROLES.map(role => loadSongPeaks(song, role)));
        if (cancelled) return;

        const peaksByRole = {} as Record<Role, Int8Array>;
        ROLES.forEach((role, i) => { peaksByRole[role] = loadedPeaks[i]; });

        setPlaying(false);
        setPractice(song.practice);
        setSolo(NO_SOLO);
        setPosition(startAt);
        lastPositionRef.current = startAt;
        setPeaks(peaksByRole);
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

  // Clicking a waveform seeks — the one unambiguous gesture the four rows
  // carry (§5.4). The rAF loop below picks up the new position on its next
  // frame, same as the numeric seek above.
  const seekToPosition = useCallback((seconds: number) => {
    sessionRef.current?.transport.seek(seconds);
  }, []);

  // Writes the next Practice state to state and to storage together — the
  // Song's single Practice state is overwritten on every change, never
  // versioned (spec: exactly one Practice state per Song).
  const persistPractice = useCallback((next: PracticeState) => {
    setPractice(next);
    if (song) void savePractice(song.id, next);
  }, [song]);

  const changeRate = useCallback((next: number) => {
    sessionRef.current?.transport.setRate(next);
    persistPractice({ ...practice, tempo: next });
  }, [practice, persistPractice]);

  const resetRate = useCallback(() => changeRate(1), [changeRate]);

  const changeStemGain = useCallback((role: Role, value: number) => {
    sessionRef.current?.transport.setGain(role, value);
    persistPractice(withStemPatch(practice, role, { gain: value }));
  }, [practice, persistPractice]);

  const toggleStemMuted = useCallback((role: Role) => {
    const muted = !practice.stems[role].muted;
    sessionRef.current?.transport.setMuted(role, muted);
    persistPractice(withStemPatch(practice, role, { muted }));
  }, [practice, persistPractice]);

  // Solo never touches Practice state — it's a momentary gesture, not
  // persisted, and doesn't alter the soloed/other stems' stored gain/mute.
  const toggleStemSolo = useCallback((role: Role) => {
    const isSolo = !solo[role];
    sessionRef.current?.transport.setSolo(role, isSolo);
    setSolo({ ...solo, [role]: isSolo });
  }, [solo]);

  // The playhead: main-thread arithmetic against the transport's anchor,
  // evaluated at `currentTime - outputLatency` so it tracks what's actually
  // in the listener's ears (§4.6) — never a message from the worklet, which
  // would floor at 20 Hz and visibly stutter against this 60 fps repaint.
  const lastPositionRef = useRef(0);
  useEffect(() => {
    let frame: number;
    const tick = () => {
      const session = sessionRef.current;
      if (session) {
        const { transport, audioContext } = session;
        const at = audioContext.currentTime - audioContext.outputLatency;
        const next = transport.getPosition(at);
        // Skip the re-render when the position hasn't moved (e.g. paused,
        // where inputAt holds steady) — still evaluated every frame so a
        // seek or rate change is picked up on the very next one.
        if (next !== lastPositionRef.current) {
          lastPositionRef.current = next;
          setPosition(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

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
          <>
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
              <span className="player-playhead">{formatPosition(position)}</span>
            </div>
            <div className="player-tempo">
              <label>
                Tempo{' '}
                <input
                  type="range"
                  min={MIN_RATE}
                  max={MAX_RATE}
                  step={0.01}
                  value={practice.tempo}
                  onChange={e => changeRate(Number(e.target.value))}
                />
              </label>
              <span className="player-tempo-readout">{formatRate(practice.tempo)}</span>
              <button onClick={resetRate} disabled={practice.tempo === 1}>Reset to 1×</button>
            </div>
            {peaks && (
              <WaveformStack
                key={song.id}
                peaks={peaks}
                stems={practice.stems}
                durationSec={song.durationSec}
                sampleRate={song.sampleRate}
                position={position}
                onSeek={seekToPosition}
              />
            )}
            <div className="player-stems">
              {ROLES.map(role => {
                const stem = practice.stems[role];
                return (
                  <div className="player-stem-row" key={role}>
                    <span className="player-stem-role">{ROLE_LABELS[role]}</span>
                    <label className="player-stem-gain">
                      Gain{' '}
                      <input
                        type="range"
                        min={MIN_GAIN}
                        max={MAX_GAIN}
                        step={0.01}
                        value={stem.gain}
                        onChange={e => changeStemGain(role, Number(e.target.value))}
                      />
                    </label>
                    <span className="player-stem-gain-readout">{formatGain(stem.gain)}</span>
                    <button
                      className={stem.muted ? 'player-stem-toggle player-stem-toggle--active' : 'player-stem-toggle'}
                      aria-pressed={stem.muted}
                      onClick={() => toggleStemMuted(role)}
                    >
                      Mute
                    </button>
                    <button
                      className={solo[role] ? 'player-stem-toggle player-stem-toggle--active' : 'player-stem-toggle'}
                      aria-pressed={solo[role]}
                      onClick={() => toggleStemSolo(role)}
                    >
                      Solo
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <JobStatusBar />
    </div>
  );
}
