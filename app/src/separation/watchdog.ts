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

// No source in this repo reports the real PROGRESS_UPDATE cadence — it comes
// from the vendored demucs.cpp WASM build. Start conservative; revisit if
// real-world use shows false positives (cadence sparser than this on slow
// hardware) or an unacceptably long wait before a real stall is caught.
export const STALL_TIMEOUT_MS = 5 * 60 * 1000;

export function isStalled(lastActivityAt: number, now: number, timeoutMs = STALL_TIMEOUT_MS): boolean {
  return now - lastActivityAt > timeoutMs;
}
