// Trims whitespace and rejects a blank result — an empty title is never
// persisted, so committing Rename with nothing typed is a no-op rather than
// blanking the Song.
export function normalizeTitle(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed;
}
