// Shared by viewport.ts (seconds/duration bounds) and pixels.ts
// (source-column bounds) — same three-argument shape, no domain coupling.
export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
