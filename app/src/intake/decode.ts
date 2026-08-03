export interface DecodeResult {
  durationSec: number;
  sampleRate: number; // always 44100 — the OfflineAudioContext is pinned to it
}

export class DecodeError extends Error {
  readonly browserLabel: string;
  constructor(browserLabel: string) {
    super(
      `${browserLabel} couldn't decode this file. Its format isn't supported here — ` +
        'the same file may open in another browser, or you can convert it to WAV or FLAC, ' +
        'which work everywhere.',
    );
    this.name = 'DecodeError';
    this.browserLabel = browserLabel;
  }
}

// Priority order matters: Edge contains "Chrome", Chrome contains "Safari".
export function browserName(ua: string): string {
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome|Chromium/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Your browser';
}

// Decode bytes in an OfflineAudioContext pinned to 44100 Hz.
// The context's sample rate governs decodeAudioData's resampling target —
// an unpinned context would silently round-trip 44.1→48→44.1 on some platforms.
// decodeAudioData detaches the input ArrayBuffer; callers must pass a copy if
// the original bytes are needed afterwards.
export async function decodeAudio(
  bytes: ArrayBuffer,
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): Promise<DecodeResult> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 44100, sampleRate: 44100 });
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    return { durationSec: buffer.duration, sampleRate: 44100 };
  } catch {
    throw new DecodeError(browserName(ua));
  }
}
