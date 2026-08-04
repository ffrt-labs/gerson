// 1 worker per 4 GB RAM — demucs peaks at ~2.3–2.5 GB RSS per instance.
const RAM_GB_PER_WORKER = 4;

/**
 * Estimate the number of separation workers to spawn, based on available
 * physical memory.  Never user-facing — callers must not expose this value.
 */
export function computeWorkerCount(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem > 0) {
    return Math.max(1, Math.floor(mem / RAM_GB_PER_WORKER));
  }
  // deviceMemory unavailable — safe default.
  return 1;
}
