export type Role = 'vocals' | 'drums' | 'bass' | 'other';

export const ROLES: readonly Role[] = ['vocals', 'drums', 'bass', 'other'] as const;

export interface Recording {
  path: string;
  bytes: number;
  mimeType: string;
  origin: 'uploaded' | 'summed';
}

export interface StemRef {
  path: string;
  bytes: number;
  peaksPath: string;
}

export interface StemState {
  gain: number;   // 0–1.5, default 1
  muted: boolean; // default false
}

export interface LoopRegion {
  startSec: number;
  endSec: number;
}

export interface PracticeState {
  tempo: number;               // 0.5–2.0, default 1
  loop: LoopRegion | null;     // null = no region drawn yet
  loopEnabled: boolean;        // whether playback repeats within `loop` — independent
                                // of the region itself, so toggling off doesn't lose it
  stems: Record<Role, StemState>;
}

export interface Song {
  id: string;          // content hash of Recording bytes
  title: string;
  durationSec: number;
  sampleRate: number;  // always 44100
  createdAt: number;   // epoch ms
  recording: Recording;
  stems: Record<Role, StemRef>;
  practice: PracticeState;
}

export type SeparationStatus = 'queued' | 'running' | 'failed';

// Named, not generalised: each cause leads to a different suggested action.
// A cancellation is never one of these — cancelling deletes the Separation
// outright rather than leaving a failed record behind. 'stalled' is distinct
// from 'worker': both end in a worker crash, but 'stalled' means the watchdog
// gave up waiting on a worker that never posted anything at all (no error
// event either), vs. 'worker' catching an actual thrown/uncaught error.
// 'decode' is caught earlier still, on the main thread before the worker is
// ever dispatched — a bad file/format, not a worker problem, so it gets its
// own advice rather than falling into 'worker's memory-pressure framing.
export type SeparationFailureCause = 'worker' | 'storage' | 'stalled' | 'decode';

export interface Separation {
  id: string;          // same content hash as the Song it will become
  title: string;
  durationSec: number; // decoded duration, for time-estimate display
  status: SeparationStatus;
  uploadPath: string;  // OPFS path to the uploaded bytes
  progress: number;    // 0–1, from demucs.cpp PROGRESS_UPDATE
  error: string | null;                    // raw message, populated when failed
  cause: SeparationFailureCause | null;     // populated when failed; drives the user-facing advice
  failedAt: number | null;                 // epoch ms, populated when failed
  startedAt: number;   // epoch ms, when the Separation was first queued
  interrupted: boolean; // true when a running job was reverted to queued by a reload; waits for Resume
  queueOrder: number;   // dispatch order among queued, non-interrupted Separations; lower runs sooner
}

export function defaultPracticeState(): PracticeState {
  return {
    tempo: 1,
    loop: null,
    loopEnabled: false,
    stems: {
      vocals: { gain: 1, muted: false },
      drums:  { gain: 1, muted: false },
      bass:   { gain: 1, muted: false },
      other:  { gain: 1, muted: false },
    },
  };
}
