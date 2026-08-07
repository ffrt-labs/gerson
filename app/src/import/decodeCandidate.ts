/**
 * Per-file decode for import (§6.2) — the pass that both verifies a
 * candidate is valid audio and produces the stereo PCM peaks/summing need.
 *
 * FLAC and WAV (our own export formats, and Demucs CLI / Spleeter's usual
 * output) decode natively: fast, exact, tag-preserving, and — unlike the
 * browser decoder — testable without a DOM. Anything else, or a native file
 * whose own sample rate isn't already 44100, falls back to the browser's
 * decodeAudioData pinned to 44100 — the only reliable oracle for arbitrary
 * formats (§7.1), and the one place a mismatched rate actually resamples on
 * the way in, matching separation's own decode guarantee.
 */

import { decodeFlac, isFlacFile, SAMPLE_RATE } from '../codec/flac.ts';
import { decodeWav, isWavFile } from '../codec/wav.ts';
import { DecodeError, browserName } from '../intake/decode.ts';

export interface DecodedCandidate {
  left: Float32Array;
  right: Float32Array;
  durationSec: number;
}

export interface DecodeCandidateDeps {
  decodeViaBrowser: (bytes: ArrayBuffer, ua?: string) => Promise<DecodedCandidate>;
}

function toStereo(channels: Float32Array[]): DecodedCandidate {
  const left = channels[0];
  const right = channels.length > 1 ? channels[1] : channels[0];
  return { left, right, durationSec: left.length / SAMPLE_RATE };
}

async function decodeViaBrowserDefault(bytes: ArrayBuffer, ua?: string): Promise<DecodedCandidate> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    const left = buffer.getChannelData(0).slice();
    const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
    return { left, right, durationSec: buffer.duration };
  } catch {
    throw new DecodeError(browserName(ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')));
  }
}

const defaultDeps: DecodeCandidateDeps = { decodeViaBrowser: decodeViaBrowserDefault };

// Native paths never throw out of this function — any failure (corrupt
// FLAC, unparseable WAV chunk layout) falls through to the browser decoder
// instead, since a signature match is only a hint about which decoder to
// try first, never the final word on whether the file is valid audio.
function tryNativeDecode(bytes: Uint8Array): DecodedCandidate | null | Promise<DecodedCandidate | null> {
  if (isFlacFile(bytes)) {
    return decodeFlac(bytes)
      .then(({ channels, sampleRate }) => (sampleRate === SAMPLE_RATE ? toStereo(channels) : null))
      .catch(() => null);
  }
  if (isWavFile(bytes)) {
    try {
      const { channels, sampleRate } = decodeWav(bytes);
      return sampleRate === SAMPLE_RATE ? toStereo(channels) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Decodes one import candidate to stereo PCM pinned to 44100 Hz. */
export async function decodeCandidate(
  bytes: Uint8Array,
  deps: DecodeCandidateDeps = defaultDeps,
): Promise<DecodedCandidate> {
  const native = await tryNativeDecode(bytes);
  if (native) return native;

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return deps.decodeViaBrowser(arrayBuffer);
}
