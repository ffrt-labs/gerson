import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getSong } from '../storage/db.ts';
import { savePractice } from '../library/engine.ts';
import { createTransport, type Transport } from '../playback/transport.ts';
import { createPlaybackContext, sampleRateMismatch } from '../playback/context.ts';
import { songStemLoader } from '../playback/loadSong.ts';
import { playbackMemoryBytes, exceedsBudget, DESKTOP_MEMORY_BUDGET_BYTES } from '../playback/memory.ts';
import { getMonoPreference, setMonoPreference } from '../playback/monoPreference.ts';
import { loadSongPeaks } from '../waveform/loadPeaks.ts';
import { mixPeaks } from '../waveform/mix.ts';
import { WaveformStage } from '../components/WaveformStage.tsx';
import { StemCard } from '../components/StemCard.tsx';
import { TransportDock } from '../components/TransportDock.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { PrecisionDrawer, type LoopField } from '../components/PrecisionDrawer.tsx';
import { OfflineChip } from '../components/OfflineChip.tsx';
import { formatClock, formatDiskSize } from '../format/units.ts';
import {
  LOOP_STEP_SEC,
  resizeStart,
  resizeEnd,
  setLength,
  moveRegion,
  setStartFromPlayhead,
  setEndFromPlayhead,
} from '../waveform/loop.ts';
import { ROLES, defaultPracticeState, type LoopRegion, type PracticeState, type Role, type Song } from '../domain/types.ts';

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
// below for the Song fetch itself.
interface LoadState {
  songId: string;
  status: LoadStatus;
  error: string | null;
}

async function releaseSession(session: Session): Promise<void> {
  await session.transport.dispose();
  await session.audioContext.close();
}

// The region only actually loops when both a region is drawn and the
// toggle is on (§5.4 acceptance: toggling off must not lose the region) —
// this is what Transport.setLoop and the Song's saved practice both need.
function effectiveLoop(practice: PracticeState): LoopRegion | null {
  return practice.loopEnabled ? practice.loop : null;
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
  const [practice, setPractice] = useState<PracticeState>(defaultPracticeState());
  // A device-level preference in localStorage, not part of Practice state
  // (§4.5) — the same library may want different answers on different
  // machines, so it's read once per mount rather than carried on the Song.
  const [mono, setMono] = useState(() => getMonoPreference());
  // Solo is a momentary gesture (never persisted) — always off on open.
  const [solo, setSolo] = useState<Record<Role, boolean>>(NO_SOLO);
  const [position, setPosition] = useState(0);
  const [peaks, setPeaks] = useState<Record<Role, Int8Array> | null>(null);
  // Which loop readout the arrow keys nudge — set by the precision drawer's
  // own fields, not persisted (a UI-only cursor, not Practice state). With
  // no field focused, the arrows move the whole region instead.
  const [focusedLoopField, setFocusedLoopField] = useState<LoopField | null>(null);
  // The two drawers this redesign adds. Local presentation state only; no
  // new domain concepts.
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  // A stale result from a previous Song reads as 'loading', not an error
  // state, until proven otherwise.
  const currentLoad = song && loadState?.songId === song.id ? loadState : null;
  const loadStatus: LoadStatus = currentLoad?.status ?? 'loading';
  const loadError = currentLoad?.error ?? null;

  // Loads the four Stems into a fresh transport whenever the resolved Song
  // changes, or the mono override is flipped. The four Stems load
  // sequentially, decoded straight to transferable Float32Arrays and handed
  // to the stretcher one at a time (§4.4) — that interleaving lives in
  // createTransport/loadSongStem, this effect just owns the session's
  // lifetime. Mono has to rebuild the session rather than adjust it live:
  // the stretcher's own output channel count is fixed at node creation, and
  // `addBuffers` can only be called once per stem (§4.3), so toggling mono
  // means starting over — same as reopening the Song.
  useEffect(() => {
    if (!song) return;
    let cancelled = false;
    const songId = song.id;

    // Pinned to the pipeline's sample rate — an unpinned context adopts the
    // output device rate and plays the 44.1kHz stems 8.84% fast and sharp
    // (#89). See playback/context.ts for why there is no fallback.
    const audioContext = createPlaybackContext();
    if (sampleRateMismatch(audioContext.sampleRate, song.sampleRate)) {
      console.warn(
        `[playback] AudioContext is ${audioContext.sampleRate}Hz but Song "${song.id}" is ` +
          `${song.sampleRate}Hz — playback will be off by ${(audioContext.sampleRate / song.sampleRate).toFixed(4)}x.`,
      );
    }
    createTransport(audioContext, songStemLoader(song, mono), mono)
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
        transport.setLoop(effectiveLoop(song.practice));
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
  }, [song, mono]);

  // The Stage draws one full-mix waveform rather than four stacked rows, so
  // the four Stems' peaks are combined once per load — not per frame, and
  // not per resize.
  const stagePeaks = useMemo(() => (peaks ? mixPeaks(peaks) : null), [peaks]);

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

  // Clicking the waveform seeks; dragging it scrubs (§5.4). The rAF loop
  // below picks up the new position on its next frame.
  const seekToPosition = useCallback((seconds: number) => {
    sessionRef.current?.transport.seek(seconds);
  }, []);

  // Skip is relative to where the playhead actually is, clamped to the Song
  // — seeking past the end would leave the transport running off the end of
  // its own buffers, and a negative seek is meaningless.
  const skipBy = useCallback((deltaSec: number) => {
    if (!song) return;
    const target = Math.min(song.durationSec, Math.max(0, position + deltaSec));
    seekToPosition(target);
  }, [song, position, seekToPosition]);

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

  // The mono override (§4.5): a manual, always-available preference stored
  // in localStorage, never in Practice state. Toggling it rebuilds the
  // session (see the effect above) rather than adjusting live.
  const toggleMono = useCallback(() => {
    const next = !mono;
    setMonoPreference(next);
    setMono(next);
  }, [mono]);

  // The one path every loop mutation funnels through — toggling on/off
  // included — writing whichever of `loop`/`loopEnabled` the caller passes
  // to Practice state, and pushing the *effective* region (null unless
  // enabled) to the transport in the same call.
  const commitLoop = useCallback((patch: Partial<Pick<PracticeState, 'loop' | 'loopEnabled'>>) => {
    const next: PracticeState = { ...practice, ...patch };
    sessionRef.current?.transport.setLoop(effectiveLoop(next));
    persistPractice(next);
  }, [practice, persistPractice]);

  // The only handler the loop lane's drag calls — create, resize, and move
  // all land here (§5.4). Force-enables looping: dragging in the lane is a
  // clear signal of intent to loop, unlike typing an exact number into an
  // already-set-up region (the numeric edits below leave enabled alone).
  const changeLoop = useCallback((region: LoopRegion) => {
    commitLoop({ loop: region, loopEnabled: true });
  }, [commitLoop]);

  const toggleLoop = useCallback(() => {
    commitLoop({ loopEnabled: !practice.loopEnabled });
  }, [commitLoop, practice.loopEnabled]);

  // Clearing is the one action that discards the region itself, so it turns
  // the toggle off too — leaving `loopEnabled` on with nothing to repeat
  // would show an engaged Loop button governing nothing.
  const clearLoop = useCallback(() => {
    commitLoop({ loop: null, loopEnabled: false });
  }, [commitLoop]);

  // Set-loop-start/end from the playhead (§5.4's load-bearing precision
  // path) — placing an edge by ear rather than by eye. With no region yet,
  // this seeds one running to the nearest song boundary. Also
  // force-enables, same reasoning as changeLoop above.
  const setLoopStartFromPlayhead = useCallback(() => {
    if (!song) return;
    commitLoop({ loop: setStartFromPlayhead(practice.loop, position, song.durationSec), loopEnabled: true });
  }, [song, practice.loop, position, commitLoop]);

  const setLoopEndFromPlayhead = useCallback(() => {
    if (!song) return;
    commitLoop({ loop: setEndFromPlayhead(practice.loop, position, song.durationSec), loopEnabled: true });
  }, [song, practice.loop, position, commitLoop]);

  // The three numeric readouts, typed or stepped directly — these leave the
  // enabled state exactly as it was, unlike drag/set-from-playhead.
  const editLoopField = useCallback((field: LoopField, value: number) => {
    if (!practice.loop || !song || !Number.isFinite(value)) return;
    const region = practice.loop;
    if (field === 'start') commitLoop({ loop: resizeStart(region, value) });
    else if (field === 'end') commitLoop({ loop: resizeEnd(region, value, song.durationSec) });
    else commitLoop({ loop: setLength(region, value, song.durationSec) });
  }, [practice.loop, song, commitLoop]);

  // Shifts the whole region, preserving its length — the gesture behind
  // both the drawer's four nudge buttons and the bare arrow keys.
  const nudgeRegion = useCallback((deltaSec: number) => {
    if (!practice.loop || !song) return;
    commitLoop({ loop: moveRegion(practice.loop, deltaSec, song.durationSec) });
  }, [practice.loop, song, commitLoop]);

  // `←`/`→` move whichever readout has focus, and the whole region when
  // none does — so the keys do something useful whether or not the drawer
  // is open.
  const nudgeFromKeyboard = useCallback((deltaSec: number) => {
    if (!practice.loop || !song) return;
    const region = practice.loop;
    if (focusedLoopField === 'start') commitLoop({ loop: resizeStart(region, region.startSec + deltaSec) });
    else if (focusedLoopField === 'end') commitLoop({ loop: resizeEnd(region, region.endSec + deltaSec, song.durationSec) });
    else if (focusedLoopField === 'length') commitLoop({ loop: setLength(region, region.endSec - region.startSec + deltaSec, song.durationSec) });
    else nudgeRegion(deltaSec);
  }, [practice.loop, focusedLoopField, song, commitLoop, nudgeRegion]);

  const seekLoopStart = useCallback(() => {
    if (practice.loop) seekToPosition(practice.loop.startSec);
  }, [practice.loop, seekToPosition]);

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
        // seek or rate change is picked up on the very next one. The finite
        // check has to come first: `NaN !== NaN` is true, so a non-finite
        // clock reading would invert this guard from "skip the update" into
        // "update on every single frame, forever", since the value can never
        // compare equal to itself. Dropping the frame keeps the last good
        // position instead of latching a poison one into the whole tree.
        if (Number.isFinite(next) && next !== lastPositionRef.current) {
          lastPositionRef.current = next;
          setPosition(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Keyboard shortcuts (§5.4/§10.3) — set-from-playhead is load-bearing,
  // not a power-user extra, so it earns real bindings alongside transport
  // basics. The precision drawer advertises every one of these, so each has
  // to actually be bound: a hint that lies is worse than no hint.
  //
  // Left/right go through nudgeFromKeyboard whether or not a readout has
  // focus; every other binding is ignored while focus sits in a text-entry
  // control, so typing in a number field isn't hijacked.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      const isTextEntry = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Inside a field, the arrows only mean "nudge" for the three loop
        // readouts — anywhere else they belong to the caret.
        if (isTextEntry && !focusedLoopField) return;
        e.preventDefault();
        nudgeFromKeyboard(e.key === 'ArrowLeft' ? -LOOP_STEP_SEC : LOOP_STEP_SEC);
        return;
      }

      if (isTextEntry) return;

      if (e.key === ' ') {
        e.preventDefault();
        if (playing) pause(); else play();
      } else if (e.key === '[') {
        setLoopStartFromPlayhead();
      } else if (e.key === ']') {
        setLoopEndFromPlayhead();
      } else if (e.key.toLowerCase() === 'l') {
        toggleLoop();
      } else if (e.key >= '1' && e.key <= '4') {
        toggleStemMuted(ROLES[Number(e.key) - 1]);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedLoopField, nudgeFromKeyboard, playing, play, pause, setLoopStartFromPlayhead, setLoopEndFromPlayhead, toggleLoop, toggleStemMuted]);

  // Computed straight from duration — the half of the memory policy we
  // know exactly, before a byte of this Song is decoded (§4.5).
  const memoryBytes = song ? playbackMemoryBytes(song.durationSec, song.sampleRate, mono) : 0;
  const memoryOverBudget = song ? exceedsBudget(memoryBytes) : false;

  const ready = song && loadStatus === 'ready';

  return (
    <div className="app-frame player">
      <header className="app-header">
        <Link to="/" className="btn btn--ghost btn--dense" aria-label="Back to the library">
          <span className="icon" aria-hidden="true">arrow_back</span>
          Library
        </Link>
        <div className="app-header-title">
          <h1 className="player-title">{song ? song.title : 'Player'}</h1>
          {song && (
            <p className="player-meta mono">
              {formatClock(song.durationSec)} · 4 stems · {(song.sampleRate / 1000).toFixed(1)} kHz
            </p>
          )}
        </div>
        <div className="app-header-actions">
          <OfflineChip />
          <button
            type="button"
            className="btn btn--secondary btn--dense"
            disabled={!ready}
            onClick={() => setExportSheetOpen(true)}
          >
            <span className="icon" aria-hidden="true">download</span>
            Export
          </button>
        </div>
      </header>

      <main className="app-main player-main">
        {!id ? (
          <p className="empty-state">No song open.</p>
        ) : song === undefined ? null : song === null ? (
          <p className="empty-state">Song not found.</p>
        ) : loadStatus === 'loading' ? (
          <p className="empty-state">Loading…</p>
        ) : loadStatus === 'error' ? (
          <p className="alert-note alert-note--danger">{loadError}</p>
        ) : (
          <>
            {/* Under budget: no message at all (§4.5) — only ever shown once over. */}
            {memoryOverBudget && (
              <p className="alert-note alert-note--loop">
                <span className="icon" aria-hidden="true">warning</span>
                This song needs about {formatDiskSize(memoryBytes)} of memory to play — over the
                {' '}{formatDiskSize(DESKTOP_MEMORY_BUDGET_BYTES)} desktop budget. It will still try;
                turn on Mono in Precision to halve the cost.
              </p>
            )}

            <WaveformStage
              key={song.id}
              peaks={stagePeaks}
              durationSec={song.durationSec}
              sampleRate={song.sampleRate}
              position={position}
              onSeek={seekToPosition}
              loop={practice.loop}
              loopEnabled={practice.loopEnabled}
              onChangeLoop={changeLoop}
            />

            <p className="legend legend--sm stem-grid-legend">
              <span className="stem-grid-legend-wide">Stems</span>
              {/* Design 2d asks the legend to name the gesture. It names the
                  Mute button rather than the whole card: making the card
                  itself the target would nest the Solo button inside a
                  clickable parent, and a Solo press would mute as well. */}
              <span className="stem-grid-legend-compact">Tap mute to drop a stem out</span>
            </p>
            <div className="stem-grid">
              {ROLES.map((role, index) => (
                <StemCard
                  key={`${song.id}:${role}`}
                  role={role}
                  index={index}
                  stem={practice.stems[role]}
                  solo={solo[role]}
                  peaks={peaks?.[role] ?? null}
                  durationSec={song.durationSec}
                  sampleRate={song.sampleRate}
                  onChangeGain={changeStemGain}
                  onToggleMuted={toggleStemMuted}
                  onToggleSolo={toggleStemSolo}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {ready && precisionOpen && (
        <PrecisionDrawer
          loop={practice.loop}
          mono={mono}
          onClose={() => setPrecisionOpen(false)}
          onEditLoopField={editLoopField}
          onNudgeRegion={nudgeRegion}
          onClearLoop={clearLoop}
          onSetLoopStart={setLoopStartFromPlayhead}
          onSetLoopEnd={setLoopEndFromPlayhead}
          onSeek={seekToPosition}
          onSeekLoopStart={seekLoopStart}
          onToggleMono={toggleMono}
          onFocusField={setFocusedLoopField}
        />
      )}

      {ready && (
        <TransportDock
          playing={playing}
          position={position}
          durationSec={song.durationSec}
          tempo={practice.tempo}
          loopEnabled={practice.loopEnabled}
          precisionOpen={precisionOpen}
          onPlay={play}
          onPause={pause}
          onSkip={skipBy}
          onChangeRate={changeRate}
          onResetRate={resetRate}
          onToggleLoop={toggleLoop}
          onSetLoopStart={setLoopStartFromPlayhead}
          onSetLoopEnd={setLoopEndFromPlayhead}
          onTogglePrecision={() => setPrecisionOpen(v => !v)}
        />
      )}

      {ready && exportSheetOpen && (
        <ExportSheet
          song={song}
          practice={practice}
          solo={solo}
          onClose={() => setExportSheetOpen(false)}
        />
      )}
    </div>
  );
}
