import { useCallback, useRef, useState } from 'react';
import type { Role } from '../domain/types.ts';
import { createTransport, type StemBuffers, type Transport } from '../playback/transport.ts';
import { createPlaybackContext } from '../playback/context.ts';

// Dev-only route for issue #23: exercises the four-stretcher transport
// wrapper against the fixture stems, with no storage layer and no Song
// involved. Fixtures live at public/dev-stems/<role>.wav — gitignored
// (*.wav), copy them in locally from prototype/playback-harness before use.
async function fetchStem(role: Role): Promise<StemBuffers> {
  const response = await fetch(`/dev-stems/${role}.wav`);
  if (!response.ok) throw new Error(`${role}.wav: ${response.status} ${response.statusText}`);
  const bytes = await response.arrayBuffer();

  // decodeAudioData, not the FLAC codec — these fixtures are WAV, and this
  // harness is explicitly scoped away from the storage/codec ticket (§4.4).
  const probe = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44100 });
  const decoded = await probe.decodeAudioData(bytes);

  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    // A standalone copy, not a view into the AudioBuffer's own storage —
    // addBuffers transfers this array's buffer, and the AudioBuffer must
    // stay intact regardless.
    channels.push(Float32Array.from(decoded.getChannelData(c)));
  }
  return { channels };
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function PlaybackHarness() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seekInput, setSeekInput] = useState('0');
  const transportRef = useRef<Transport | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      // Created synchronously in the click handler so it starts 'running'
      // under the browser's user-gesture autoplay policy. Pinned to the
      // pipeline's rate for the same reason the Player is (#89) — the
      // fixtures decode at 44100, and an unpinned context here would
      // reproduce the very bug this harness exists to catch.
      const audioContext = createPlaybackContext();

      // fetchStem is handed straight to createTransport as the StemLoader —
      // it fetches and decodes one role at a time, only as each is needed,
      // keeping the load's memory spike one stem wide (§4.4).
      transportRef.current = await createTransport(audioContext, fetchStem);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  const play = useCallback(() => {
    transportRef.current?.play();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    transportRef.current?.pause();
    setPlaying(false);
  }, []);

  const seek = useCallback(() => {
    const seconds = Number(seekInput);
    if (Number.isFinite(seconds)) transportRef.current?.seek(seconds);
  }, [seekInput]);

  return (
    <div style={{ padding: '2rem', maxWidth: '32rem' }}>
      <h1>Playback harness</h1>
      <p>Four-stretcher transport wrapper — fixture stems, no storage, no Song. Issue #23.</p>

      {status === 'idle' && <button onClick={load}>Load fixture stems</button>}
      {status === 'loading' && <p>Loading…</p>}
      {status === 'error' && <p style={{ color: '#f66' }}>{error}</p>}

      {status === 'ready' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
          <button onClick={play} disabled={playing}>Play</button>
          <button onClick={pause} disabled={!playing}>Pause</button>
          <label>
            Seek to (s):{' '}
            <input
              type="number"
              value={seekInput}
              onChange={e => setSeekInput(e.target.value)}
              style={{ width: '5rem' }}
            />
          </label>
          <button onClick={seek}>Seek</button>
        </div>
      )}
    </div>
  );
}
