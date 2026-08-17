/**
 * Pure stall-detection policy for the separation engine — kept free of
 * Worker/storage side effects so it's unit-testable on its own, mirroring
 * queue.ts. A worker can die (OOM kill, hard crash) without ever posting an
 * 'error' event, leaving a job 'running' forever with nothing to catch it;
 * this decides when that silence has gone on long enough to give up on it.
 *
 * Inactivity-based, not a fixed wall-clock cap: a genuinely slow job (long
 * song, slow hardware) keeps posting progress and is never falsely flagged —
 * only a worker that's gone completely silent trips this.
 */

// 5 minutes — but not for the reason this constant was first given.
//
// The cadence is now measured: ~3.6 PROGRESS_UPDATE per second, worst
// in-inference gap 1.48 s, some 200x inside this timeout. So progress is not
// what the number is protecting against. The binding window is the *silent
// head*: lastActivityAt is set at claim, and main-thread decode plus ~12 s of
// model setup elapse — roughly 15 s — before the first progress message
// arrives. 5 minutes clears that head on a machine ~25x slower than the one
// it was measured on. Recycling the worker on drain makes the cold head more
// often true, never less, so it needs no retune for that either.
//
// A single constant, not scaled per job: the silent windows are fixed cost,
// so a durationSec-derived tolerance would track the wrong variable.
//
// It errs long deliberately, because the errors are asymmetric. Firing is
// irreversible — terminate(), a failed row, no partial credit — and re-spends
// 6:36 to 15:05. A slow detect costs a stare at a background job that already
// has ~20 minutes of tolerance in hand.
//
// Not deletable, either: a spinning encoder (≥14.5 min at 100% CPU, no error,
// no message — the wasm2js FLAC build, see codec/flac.ts) is a real member of
// the class this insures against.
export const STALL_TIMEOUT_MS = 5 * 60 * 1000;

// Head and tail stay unmonitored, by design — stated here so the next reader
// doesn't re-file it as a gap. The post-inference tail is ~2.4 s, which this
// timeout swallows some 125x over; heartbeating it would change no outcome.
// engine.ts's 30 s poll interval lands detection between 5:00 and 5:30,
// immaterial at this tolerance.

export function isStalled(lastActivityAt: number, now: number, timeoutMs = STALL_TIMEOUT_MS): boolean {
  return now - lastActivityAt > timeoutMs;
}
