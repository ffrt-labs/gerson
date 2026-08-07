// Filesystem-safe stem filenames: `<title> - <role>.<ext>`. Strips
// characters illegal on Windows/macOS/Linux so a Song's free-text title
// never produces a name the platform's save dialog rejects.
const UNSAFE_CHARS = /[/\\:*?"<>|]+/g;
const EXTRA_SPACES = /\s+/g;

export function sanitizeForFilename(text: string): string {
  return text.replace(UNSAFE_CHARS, ' ').replace(EXTRA_SPACES, ' ').trim();
}

export function stemFilename(title: string, role: string, extension: string): string {
  return `${sanitizeForFilename(title)} - ${role}.${extension}`;
}
