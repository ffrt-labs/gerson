/**
 * The mono override (§4.5) is a device-level preference in `localStorage`,
 * never part of `PracticeState` — the same library may want different
 * answers on different machines, and it must not travel with an export or
 * be written to the Song.
 */

export const MONO_PREFERENCE_KEY = 'gerson:mono-playback';

export function getMonoPreference(storage: Storage = localStorage): boolean {
  return storage.getItem(MONO_PREFERENCE_KEY) === 'true';
}

export function setMonoPreference(mono: boolean, storage: Storage = localStorage): void {
  storage.setItem(MONO_PREFERENCE_KEY, mono ? 'true' : 'false');
}
