// Hand-written types for signalsmith-stretch 1.3.2 (MIT) — the package ships
// none (upstream issue #26). Covers only the surface our transport wrapper
// uses; see node_modules/signalsmith-stretch/README.md for the full API.
declare module 'signalsmith-stretch' {
  // A change to schedule, applied at an absolute AudioContext time. Passing
  // `input` makes this an absolute seek — omit it for a rate/gain-only
  // change, or playback teleports. See app/src/playback/anchor.ts.
  export interface StretchScheduleOptions {
    /** AudioContext time this change takes effect, written into the node's timeline. */
    output?: number;
    /** AudioContext time schedule() reads to place this change among prior ones — must match `output`. */
    outputTime?: number;
    active?: boolean;
    /** Absolute position (seconds) in the input buffer. An absolute seek — never send on a non-seek change. */
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchScheduleResult extends StretchScheduleOptions {
    output: number;
    input: number;
    rate: number;
    active: boolean;
  }

  export interface StretchConfig {
    /** Block length in ms (e.g. 120). 0/null falls back to `preset`. */
    blockMs?: number | null;
    /** Defaults to blockMs / 4. */
    intervalMs?: number;
    /** Spreads computation more evenly across a quantum. Default false. */
    splitComputation?: boolean;
    preset?: 'default' | 'cheaper';
  }

  export interface StretchNode extends AudioWorkletNode {
    /** Seconds within the input buffer, updated per setUpdateInterval's cadence. Not for playhead math — see spec §4.6. */
    readonly inputTime: number;

    configure(config: StretchConfig): Promise<void>;
    /** Latency in seconds; also how far ahead `output` should be scheduled to fully land. */
    latency(): Promise<number>;
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<void>;

    /** Convenience wrapper around schedule({active:false, output:when}). Do not use directly — see the three footguns in anchor.ts. */
    stop(when?: number): Promise<StretchScheduleResult>;
    /** Convenience wrapper around schedule(). Silently ignores its numeric argument for cross-node sync — do not use directly. */
    start(when?: number): Promise<StretchScheduleResult>;
    /** The only method the wrapper calls directly. Always set both `output` and `outputTime` to an identical absolute time across all four nodes. */
    schedule(options: StretchScheduleOptions, adjustPrevious?: boolean): Promise<StretchScheduleResult>;

    /**
     * Appends buffers (one typed array per channel) to the node's input.
     * Must be called exactly once per stem — a second call breaks playback
     * silently (digital silence, no exception). Pass `transfer` (the
     * buffers' underlying ArrayBuffers) to hand them over zero-copy; the
     * source ArrayBuffers detach.
     */
    addBuffers(buffers: Float32Array[], transfer?: ArrayBuffer[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
  }

  /** Channel configuration, as per AudioWorkletNode's options. */
  export interface StretchNodeOptions {
    numberOfInputs?: number;
    numberOfOutputs?: number;
    outputChannelCount?: number[];
  }

  /** Creates a Stretch AudioWorkletNode, registering its processor on `audioContext` on first use. */
  export default function SignalsmithStretch(
    audioContext: BaseAudioContext,
    options?: StretchNodeOptions,
  ): Promise<StretchNode>;
}
