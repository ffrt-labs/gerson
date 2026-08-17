/**
 * The length a Recording may be, and how Gerson says so when it can't be.
 *
 * Separation peaks at roughly 1872 MB + 5.03 MB per second of audio against
 * wasm32's architectural 4096 MB ceiling, past which inference aborts. The
 * fitted break lands at ~7:25 — but that is a line fitted on one machine, and
 * the sweep that produced it cleared 360 s with only 43 MB to spare. 7:00
 * leaves ~110 MB of margin, and it says itself in a sentence: a cap written
 * as "7 minutes 25 seconds" is a leaked implementation detail.
 *
 * Kept here, beside the rule, rather than in separation/copy.ts: this is a
 * constraint on what a Recording can be, refused at intake before a
 * Separation exists at all.
 */

export const MAX_RECORDING_SEC = 7 * 60;

export function exceedsLengthCap(durationSec: number): boolean {
  return durationSec > MAX_RECORDING_SEC;
}

function formatLength(durationSec: number): string {
  const total = Math.round(durationSec);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

// The rule on its own, for the one surface that has no particular Recording
// to name — causeAdvice('toolong'), which is keyed by cause alone.
export function lengthRuleSentence(): string {
  return (
    `Gerson can separate Recordings up to ${MAX_RECORDING_SEC / 60} minutes — ` +
    "a browser memory limit it can't raise."
  );
}

// Naming the file's own length is the courtesy `nospace` already extends via
// needsBytes. The reason is deliberately non-actionable — but without it a
// flat refusal reads as arbitrary product stinginess, and the natural
// response to arbitrary is to retry.
export function tooLongMessage(durationSec: number): string {
  return `That Recording is ${formatLength(durationSec)}. ${lengthRuleSentence()}`;
}
