/**
 * The live playback AudioContext (§4.1), pinned to the pipeline's sample
 * rate — the one thing every other audio context in this codebase already
 * does, and the one place it was missed.
 *
 * Stems reach the stretcher as raw Float32Array channels: `addBuffers` takes
 * no sample rate, and the node is an AudioWorkletNode, so it consumes those
 * samples at the *context's* rate. There is no channel by which it could
 * learn the PCM is 44.1 kHz. An unpinned context therefore adopts the output
 * device rate — 48000 on most hardware — and eats 44100-rate samples
 * 48000/44100 = 1.0884x too fast: 8.84% quick and ~1.5 semitones sharp.
 *
 * Pinning moves the resampling into the browser's own output stage, where it
 * is free and well-tested, rather than into our load path where it would
 * cost memory and CPU per stem and would desync `playbackMemoryBytes`.
 */

import { SAMPLE_RATE } from '../codec/flac.ts';

export type CreateAudioContext = (options: AudioContextOptions) => AudioContext;

const defaultCreateAudioContext: CreateAudioContext = options => new AudioContext(options);

/**
 * Pins to SAMPLE_RATE rather than a Song's `sampleRate` field deliberately.
 * The encoder hardcodes SAMPLE_RATE when it writes stems, so that constant
 * describes the bytes on disk; a Song row claiming anything else is wrong
 * *metadata*, not an instruction to play at that rate. Trusting the field
 * would happily play a mislabelled Song at the wrong speed — the same silent
 * failure this whole module exists to prevent. `sampleRateMismatch` below
 * turns that disagreement into a signal instead.
 *
 * Deliberately no fallback to an unpinned context if the browser rejects the
 * rate with NotSupportedError: playing a song a tone-and-a-half sharp while
 * showing no error is a worse failure than refusing to open it. The caller's
 * existing error path surfaces the throw.
 */
export function createPlaybackContext(create: CreateAudioContext = defaultCreateAudioContext): AudioContext {
  return create({ sampleRate: SAMPLE_RATE });
}

/**
 * True when a live context ended up at a different rate than the Song's PCM.
 * Only reachable if a browser silently honours a rate other than the one
 * requested, or a Song row disagrees with the pipeline — both of which are
 * inaudible as *bugs* (they sound like "this recording is a bit fast"), so
 * they are worth saying out loud where someone can grep for them.
 */
export function sampleRateMismatch(contextRate: number, songRate: number): boolean {
  return contextRate !== songRate;
}
