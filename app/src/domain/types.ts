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
  loop: LoopRegion | null;     // null = no active loop region
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

export interface Separation {
  id: string;          // same content hash as the Song it will become
  title: string;
  status: SeparationStatus;
  uploadPath: string;  // OPFS path to the uploaded bytes
  progress: number;    // 0–1, from demucs.cpp PROGRESS_UPDATE
  error: string | null; // populated when failed; null means cancelled, not an error
  startedAt: number;   // epoch ms
}

export function defaultPracticeState(): PracticeState {
  return {
    tempo: 1,
    loop: null,
    stems: {
      vocals: { gain: 1, muted: false },
      drums:  { gain: 1, muted: false },
      bass:   { gain: 1, muted: false },
      other:  { gain: 1, muted: false },
    },
  };
}
