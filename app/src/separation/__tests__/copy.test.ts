import { describe, it, expect } from 'vitest';
import {
  CPU_CONTENTION_NOTICE,
  RESUME_NOTICE,
  MODEL_CONSENT_BODY,
  MODEL_DOWNLOADING_NOTICE,
  causeAdvice,
  modelDownloadFailureAdvice,
  evictionMessage,
  smallQuotaMessage,
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

  it('names unresponsiveness, not memory, for a stalled worker', () => {
    expect(causeAdvice('stalled').toLowerCase()).toMatch(/respond|restart/);
  });

  it('names the file/format angle, not memory, for a decode failure', () => {
    expect(causeAdvice('decode').toLowerCase()).toMatch(/format|file/);
    expect(causeAdvice('decode').toLowerCase()).not.toMatch(/memory/);
  });

  it('gives distinct advice per cause', () => {
    const causes = ['worker', 'storage', 'stalled', 'decode'] as const;
    const advices = causes.map(causeAdvice);
    expect(new Set(advices).size).toBe(advices.length);
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

describe('evictionMessage', () => {
  it('names the count of affected Songs, not per-Song wording', () => {
    expect(evictionMessage(6)).toMatch(/^Your browser cleared Gerson's stored audio\. 6 songs need to be separated again\. /);
  });

  it('uses singular grammar for exactly one Song', () => {
    expect(evictionMessage(1)).toMatch(/^Your browser cleared Gerson's stored audio\. 1 song needs to be separated again\. /);
  });

  it('is not styled or worded as a storage error', () => {
    expect(evictionMessage(3).toLowerCase()).not.toMatch(/error|fail/);
  });

  it('says export is the backup, in the product\'s own words', () => {
    expect(evictionMessage(3).toLowerCase()).toMatch(/export/);
  });
});

describe('smallQuotaMessage', () => {
  it('frames the small quota as a browser setting, not a storage error', () => {
    const msg = smallQuotaMessage(false).toLowerCase();
    expect(msg).not.toMatch(/error|fail/);
    expect(msg).toMatch(/browser|setting/);
  });

  it('says roughly how much Gerson can hold under the small quota', () => {
    expect(smallQuotaMessage(false).toLowerCase()).toMatch(/one song/);
  });

  it('names the exact browser setting and where it lives', () => {
    const msg = smallQuotaMessage(false);
    expect(msg).toMatch(/Clear cookies and site data when you close all windows/);
    expect(msg.toLowerCase()).toMatch(/site settings/);
  });

  it('folds a persist() refusal into the same message rather than a separate one', () => {
    const withoutDenial = smallQuotaMessage(false);
    const withDenial = smallQuotaMessage(true);
    expect(withDenial).not.toBe(withoutDenial);
    expect(withDenial).toContain(withoutDenial);
  });
});
