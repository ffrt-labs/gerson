import { describe, it, expect } from 'vitest';
import {
  CPU_CONTENTION_NOTICE,
  interruptedNotice,
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

describe('interruptedNotice', () => {
  it('states the event without claiming to know how it happened', () => {
    const msg = interruptedNotice(4 * 60).toLowerCase();
    expect(msg).toMatch(/closed or reloaded/);
    // The engine cannot tell a close from a reload, so the copy must not pick one.
    expect(msg).not.toMatch(/you closed|you reloaded/);
  });

  it('states the honest cost, using the same estimate as the queued badge', () => {
    expect(interruptedNotice(4 * 60)).toContain('9 minutes');
    expect(interruptedNotice(7 * 60)).toContain('15 minutes');
  });

  it('never quotes prior progress — the row is written back at zero', () => {
    expect(interruptedNotice(4 * 60)).not.toMatch(/%|progress|reached/i);
  });

  it('does not spend a sentence taking its own button label back', () => {
    // The label is "Start over"; the notice it replaced existed only to
    // explain that "Resume" did not, in fact, resume.
    expect(interruptedNotice(4 * 60).toLowerCase()).not.toMatch(/resum/);
  });
});

describe('causeAdvice', () => {
  it('names the memory angle for a worker crash / out-of-memory cause', () => {
    expect(causeAdvice('worker').toLowerCase()).toMatch(/memory|close/);
  });

  it('names the storage angle for a storage write failure', () => {
    expect(causeAdvice('storage').toLowerCase()).toMatch(/storage|space/);
  });

  it('names unresponsiveness for a stalled worker', () => {
    expect(causeAdvice('stalled').toLowerCase()).toMatch(/respond/);
  });

  it('attributes a stalled failure to nothing — silence names no cause', () => {
    // Memory pressure surfaces as a catchable RuntimeError under cause
    // 'worker', which already owns the low-memory advice. A stalled failure
    // is silence, and guessing at its cause sent users after the wrong fix.
    expect(causeAdvice('stalled').toLowerCase()).not.toMatch(/memory|resources|device|file/);
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
