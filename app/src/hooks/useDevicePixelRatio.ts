import { useState } from 'react';

// The devicePixelRatio every canvas in the app sizes its backing store to.
//
// Read once per component and never updated: a canvas that changed its
// backing-store scale mid-session would have to re-derive and repaint every
// bitmap at once, and the only way to hit it is dragging the window between
// displays of different densities. A slightly soft waveform until the next
// remount is the cheaper wrong answer.
export function useDevicePixelRatio(): number {
  const [dpr] = useState(() => window.devicePixelRatio || 1);
  return dpr;
}
