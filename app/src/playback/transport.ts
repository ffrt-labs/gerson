/**
 * The four-stretcher transport (spec §4.1–§4.3). Owns one
 * `signalsmith-stretch` AudioWorkletNode per Role, each followed by a plain
 * GainNode for trivially-live per-stem gain and mute. No storage, no Song —
 * callers hand it already-decoded buffers.
 */

import SignalsmithStretch from 'signalsmith-stretch';
import type { StretchNode } from 'signalsmith-stretch';
import type { Role } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import {
  initialTransportState,
  inputAt,
  play as playState,
  pause as pauseState,
  seek as seekState,
  setRate as setRateState,
  type ScheduleAnchor,
  type TransportState,
} from './anchor.ts';

/** One already-decoded stem: one Float32Array per channel, equal length. */
export interface StemBuffers {
  channels: Float32Array[];
}

// The minimal surface the engine needs from a stretcher node — matches
// StretchNode from 'signalsmith-stretch' structurally, narrowed so tests can
// supply fakes without a real AudioContext.
export interface StretchLike {
  configure(config: { splitComputation: boolean }): Promise<void> | void;
  schedule(options: ScheduleAnchor): unknown;
  addBuffers(buffers: Float32Array[], transfer?: ArrayBuffer[]): Promise<number> | number;
}

export interface GainLike {
  gain: { value: number };
}

export interface Transport {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setGain(role: Role, value: number): void;
  setMuted(role: Role, muted: boolean): void;
  /**
   * Soloing a Role silences the other three at the GainNode without
   * altering their own stored gain/mute (§ Practice state: solo is a
   * momentary gesture, never persisted). A soloed Role that is itself
   * muted stays silent — solo overrides other Roles, not its own mute.
   */
  setSolo(role: Role, solo: boolean): void;
  isPlaying(): boolean;
  /**
   * The input-buffer position at `atTime` (an absolute AudioContext time) —
   * pure main-thread arithmetic against the current anchor, never a worklet
   * round-trip. Callers wanting a playhead evaluate this at
   * `currentTime - outputLatency` (spec §4.6).
   */
  getPosition(atTime: number): number;
  dispose(): Promise<void>;
}

/** Loads one already-decoded Stem on demand — see createTransport. */
export type StemLoader = (role: Role) => Promise<StemBuffers>;

// 50ms of headroom — above spec §4.1's 30ms splitComputation latency cost —
// so a change lands cleanly rather than catching the node mid-quantum.
const SCHEDULE_LOOKAHEAD_SECONDS = 0.05;

/**
 * The footgun-avoiding core (§4.2), decoupled from how the nodes and gains
 * were constructed so it's unit-testable without a real AudioContext. Every
 * transport operation builds exactly one anchor and sends it to all four
 * nodes — one absolute AudioContext time, one input position, never four
 * independently-derived ones.
 */
export function createTransportEngine(
  nodes: Record<Role, StretchLike>,
  gains: Record<Role, GainLike>,
  now: () => number,
): Omit<Transport, 'dispose'> {
  let state: TransportState = initialTransportState;
  const desiredGain: Record<Role, number> = { vocals: 1, drums: 1, bass: 1, other: 1 };
  const muted: Record<Role, boolean> = { vocals: false, drums: false, bass: false, other: false };
  const soloed: Record<Role, boolean> = { vocals: false, drums: false, bass: false, other: false };

  function dispatch(next: TransportState): void {
    state = next;
    // Same anchor object to every node — never rebuilt per-node, so there is
    // no way for the four to receive subtly different values.
    for (const role of ROLES) nodes[role].schedule(next.anchor);
  }

  function anySoloed(): boolean {
    return ROLES.some(role => soloed[role]);
  }

  function appliedGain(role: Role): number {
    if (muted[role]) return 0;
    if (anySoloed() && !soloed[role]) return 0;
    return desiredGain[role];
  }

  return {
    play() {
      dispatch(playState(state, now() + SCHEDULE_LOOKAHEAD_SECONDS, state.anchor.rate));
    },
    pause() {
      dispatch(pauseState(state, now() + SCHEDULE_LOOKAHEAD_SECONDS));
    },
    seek(seconds) {
      dispatch(seekState(state, now() + SCHEDULE_LOOKAHEAD_SECONDS, seconds));
    },
    setRate(rate) {
      dispatch(setRateState(state, now() + SCHEDULE_LOOKAHEAD_SECONDS, rate));
    },
    setGain(role, value) {
      desiredGain[role] = value;
      gains[role].gain.value = appliedGain(role);
    },
    setMuted(role, isMuted) {
      muted[role] = isMuted;
      gains[role].gain.value = appliedGain(role);
    },
    setSolo(role, isSolo) {
      soloed[role] = isSolo;
      // Unlike gain/mute, a solo change can affect every Role's applied
      // gain — the other three go silent (or come back) as a side effect —
      // so all four GainNodes are recomputed, not just the touched one.
      for (const r of ROLES) gains[r].gain.value = appliedGain(r);
    },
    isPlaying() {
      return state.anchor.active;
    },
    getPosition(atTime) {
      return inputAt(state, atTime);
    },
  };
}

export type CreateStretchNode = (
  audioContext: AudioContext,
  options: { numberOfInputs: number; numberOfOutputs: number; outputChannelCount: number[] },
) => Promise<StretchNode>;

// Stems are always stereo FLAC on disk (spec §3.5) — known before any stem
// is decoded, so node creation never has to wait on `loadStem`.
const STEM_CHANNEL_COUNT = 2;

/**
 * Creates the four real nodes, configures them, loads each stem via
 * `loadStem`, and wires up the engine above. Nodes are created up front
 * (cheap — no PCM involved); stems are then loaded and fed to the stretcher
 * one role at a time, each in exactly one `addBuffers` call transferring its
 * channel ArrayBuffers (§4.3), and each is decoded and dropped before the
 * next is requested — `loadStem` isn't called for a role until the previous
 * role's buffers have already been transferred away, so the load's memory
 * spike stays one stem wide rather than steady-state-plus-four (§4.4).
 * `createNode` defaults to the real signalsmith-stretch factory; tests
 * inject a fake to run without a browser.
 */
export async function createTransport(
  audioContext: AudioContext,
  loadStem: StemLoader,
  createNode: CreateStretchNode = SignalsmithStretch,
): Promise<Transport> {
  const nodes = {} as Record<Role, StretchNode>;
  const gains = {} as Record<Role, GainNode>;

  for (const role of ROLES) {
    const node = await createNode(audioContext, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [STEM_CHANNEL_COUNT],
    });
    await node.configure({ splitComputation: true });

    const gain = audioContext.createGain();
    node.connect(gain);
    gain.connect(audioContext.destination);

    nodes[role] = node;
    gains[role] = gain;
  }

  // Sequential, not parallel: a parallel load spikes memory to steady-state
  // plus four stems; sequential keeps the spike one stem wide (§4.4).
  for (const role of ROLES) {
    const { channels } = await loadStem(role);
    // Decoded PCM is always backed by a plain ArrayBuffer, never shared.
    await nodes[role].addBuffers(channels, channels.map(c => c.buffer as ArrayBuffer));
  }

  const engine = createTransportEngine(nodes, gains, () => audioContext.currentTime);

  return {
    ...engine,
    async dispose() {
      // dropBuffers releases the stretcher's own copy of the transferred
      // audio before disconnecting — leaving the Player must not leak the
      // previous Song's buffers into the next one.
      await Promise.all(ROLES.map(async (role) => {
        await nodes[role].dropBuffers();
        nodes[role].disconnect();
        gains[role].disconnect();
      }));
    },
  };
}
