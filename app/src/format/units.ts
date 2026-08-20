/**
 * Every user-facing number in one place, so the same quantity never renders
 * two ways in two components. All of these are displayed in JetBrains Mono
 * (the design's rule: a number never renders in Sora), which is what keeps
 * a counting timecode from shifting width as its digits change.
 */

// A non-finite or negative position is floored at zero rather than
// propagated: the playhead is legitimately negative during the first
// output-latency window after Play (#87), and a poisoned clock reading
// would otherwise print as "NaN:NaN".
function safeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

// The transport readout: m:ss.hh. Rounded to hundredths *before* the
// minute/second split, so 59.999 reads "1:00.00" rather than "0:59.100".
export function formatTimecode(seconds: number): string {
  const hundredths = Math.round(safeSeconds(seconds) * 100);
  const whole = Math.floor(hundredths / 100);
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}.${pad2(hundredths % 100)}`;
}

// The meta-line duration: m:ss, rounded to the nearest second.
export function formatClock(seconds: number): string {
  const whole = Math.round(safeSeconds(seconds));
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`;
}

export function formatLengthSec(seconds: number): string {
  return `${safeSeconds(seconds).toFixed(2)}s`;
}

// Tempo is always a multiplier, never BPM — Gerson does not know a Song's
// beats per minute and never displays one (CONTEXT.md).
export function formatRate(rate: number): string {
  return `${rate.toFixed(2)}×`;
}

export function formatGain(gain: number): string {
  return gain.toFixed(2);
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Switches unit at a gigabyte: a library is quoted as "1.4 GB on disk", a
// single Song as "340 MB". Below a megabyte it stays "0 MB" rather than
// dropping to "0.0 GB", which reads as a bug on a nearly-empty library.
export function formatDiskSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function formatMegabytes(bytes: number): string {
  return String(Math.round(bytes / MB));
}
