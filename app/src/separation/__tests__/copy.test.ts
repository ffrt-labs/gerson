import { describe, it, expect } from 'vitest';
import {
  CPU_CONTENTION_NOTICE,
  RESUME_NOTICE,
  MODEL_CONSENT_BODY,
  MODEL_DOWNLOADING_NOTICE,
  causeAdvice,
  modelDownloadFailureAdvice,
} from '../copy.ts';

describe('CPU_CONTENTION_NOTICE', () => {
  it('is stated in neutral language, never as a warning', () => {
    expect(CPU_CONTENTION_NOTICE.toLowerCase()).not.toMatch(/warning|error|caution/);
    expect(CPU_CONTENTION_NOTICE).toMatch(/stutter/);
  });
});

describe('RESUME_NOTICE', () => {
  it('says resuming starts over rather than continuing', () => {
    expect(RESUME_NOTICE.toLowerCase()).toMatch(/start(s|ing)? over|from the beginning/);
  });
});

describe('causeAdvice', () => {
  it('names the memory angle for a worker crash / out-of-memory cause', () => {
    expect(causeAdvice('worker').toLowerCase()).toMatch(/memory|close/);
  });

  it('names the storage angle for a storage write failure', () => {
    expect(causeAdvice('storage').toLowerCase()).toMatch(/storage|space/);
  });

  it('gives distinct advice per cause', () => {
    expect(causeAdvice('worker')).not.toBe(causeAdvice('storage'));
  });
});

describe('MODEL_CONSENT_BODY', () => {
  it('states the size and that it downloads once', () => {
    expect(MODEL_CONSENT_BODY).toMatch(/80 MB/);
    expect(MODEL_CONSENT_BODY.toLowerCase()).toMatch(/once/);
  });

  it('reassures that the rest of the app still works offline', () => {
    expect(MODEL_CONSENT_BODY.toLowerCase()).toMatch(/offline/);
  });
});

describe('MODEL_DOWNLOADING_NOTICE', () => {
  it('is not phrased as an error', () => {
    expect(MODEL_DOWNLOADING_NOTICE.toLowerCase()).not.toMatch(/error|fail/);
  });
});

describe('modelDownloadFailureAdvice', () => {
  it('never implies the app itself failed to load', () => {
    for (const reason of ['truncated', 'hash-mismatch', 'network', 'storage'] as const) {
      expect(modelDownloadFailureAdvice(reason).toLowerCase()).not.toMatch(/gerson (failed|is broken)/);
    }
  });

  it('reassures that the library still works when the connection was the problem', () => {
    expect(modelDownloadFailureAdvice('truncated').toLowerCase()).toMatch(/still works/);
  });

  it('names the storage angle for a storage write failure', () => {
    expect(modelDownloadFailureAdvice('storage').toLowerCase()).toMatch(/storage|space/);
  });

  it('gives distinct advice per reason', () => {
    const reasons = ['truncated', 'hash-mismatch', 'network', 'storage'] as const;
    const advices = reasons.map(modelDownloadFailureAdvice);
    expect(new Set(advices).size).toBe(advices.length);
  });
});
