import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Separation } from '../domain/types.ts';
import { hasActiveSeparation } from '../pwa/updateGate.ts';

interface UpdateBannerProps {
  separations: Separation[];
}

// A new version is an affordance the user takes when convenient, never a
// forced or silent reload — and it stays hidden entirely while a Separation
// is running or queued, since reloading kills Workers mid-job (spec §8).
// `needRefresh` latches true once a waiting worker is ready and stays true
// across renders, so the banner still appears once the queue drains.
//
// Not part of the redesign's screen set: it takes the new button tiers and
// type so it doesn't look orphaned beside them, and is otherwise unchanged.
export function UpdateBanner({ separations }: UpdateBannerProps) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError: console.error,
  });

  if (!needRefresh || hasActiveSeparation(separations)) return null;

  return (
    <p className="alert-note alert-note--accent">
      <span className="icon" aria-hidden="true">info</span>
      An update is ready.
      <button
        type="button"
        className="btn btn--secondary btn--dense"
        onClick={() => updateServiceWorker(true)}
      >
        Reload to update
      </button>
    </p>
  );
}
