import { describe, it, expect } from 'vitest';
import { getMonoPreference, setMonoPreference, MONO_PREFERENCE_KEY } from '../monoPreference.ts';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size; },
  };
}

describe('getMonoPreference', () => {
  it('defaults to false (stereo) when nothing is stored', () => {
    expect(getMonoPreference(fakeStorage())).toBe(false);
  });

  it('reads a previously stored true', () => {
    const storage = fakeStorage({ [MONO_PREFERENCE_KEY]: 'true' });
    expect(getMonoPreference(storage)).toBe(true);
  });

  it('reads a previously stored false', () => {
    const storage = fakeStorage({ [MONO_PREFERENCE_KEY]: 'false' });
    expect(getMonoPreference(storage)).toBe(false);
  });

  it('treats an unrecognised stored value as false rather than throwing', () => {
    const storage = fakeStorage({ [MONO_PREFERENCE_KEY]: 'garbage' });
    expect(getMonoPreference(storage)).toBe(false);
  });
});

describe('setMonoPreference', () => {
  it('round-trips true through the same storage', () => {
    const storage = fakeStorage();
    setMonoPreference(true, storage);
    expect(getMonoPreference(storage)).toBe(true);
  });

  it('round-trips false through the same storage', () => {
    const storage = fakeStorage({ [MONO_PREFERENCE_KEY]: 'true' });
    setMonoPreference(false, storage);
    expect(getMonoPreference(storage)).toBe(false);
  });
});
