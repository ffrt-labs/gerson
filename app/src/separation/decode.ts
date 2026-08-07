/**
 * Decodes a Separation's stored Recording into everything the worker needs
 * to run: stereo PCM plus the Recording's byte count and sniffed MIME type.
 * Must run on the main thread — OfflineAudioContext is undefined inside a
 * Worker's global scope in every current browser — see intake/decode.ts,
 * which decodes here for the same reason, just for duration only.
 */

import { decodeAt44100 } from '../intake/decode.ts';

export interface RecordingPayload {
  left: Float32Array;
  right: Float32Array;
  durationSec: number;
  recordingBytes: number;
  recordingMimeType: string;
}

// decodeAt44100 detaches its input ArrayBuffer, so it gets a copy —
// detectMimeType only reads the first few bytes and runs before that copy
// is made, so it's unaffected either way.
export async function decodeRecording(
  bytes: Uint8Array,
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): Promise<RecordingPayload> {
  const recordingMimeType = detectMimeType(bytes);
  const buffer = await decodeAt44100(bytes.buffer.slice(0) as ArrayBuffer, { numberOfChannels: 2, length: 1 }, ua);
  const left = buffer.getChannelData(0).slice();
  const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
  return { left, right, durationSec: buffer.duration, recordingBytes: bytes.byteLength, recordingMimeType };
}

export function detectMimeType(bytes: Uint8Array): string {
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac';
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';
  return 'application/octet-stream';
}
