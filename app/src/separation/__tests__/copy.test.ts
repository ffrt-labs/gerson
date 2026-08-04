import { describe, it, expect } from 'vitest';
import { CPU_CONTENTION_NOTICE, RESUME_NOTICE, causeAdvice } from '../copy.ts';

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
