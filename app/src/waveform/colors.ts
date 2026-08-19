/**
 * The canvas half of the palette. These are the `--wave-*` tokens, repeated
 * here as literals because a canvas takes a colour string, not a custom
 * property — `ctx.fillStyle = 'var(--wave-solo)'` is silently ignored.
 * Keep in sync with tokens.css; nothing else in the app may invent a
 * waveform colour.
 */

export const WAVE_NEUTRAL = '#9fadc0'; // full-mix peaks
export const WAVE_STEM = '#95a2b4';    // per-stem mini waveform
export const WAVE_MUTED = '#4e5765';   // muted stem — desaturated, not dimmed
export const WAVE_SOLO = '#a8ef55';    // soloed stem, and the playhead

// Amber, and only amber, means loop. These two are --loop-region-fill and
// --loop-region-wash exactly.
export const LOOP_REGION_FILL = 'rgba(241, 176, 71, 0.30)';
export const LOOP_REGION_WASH = 'rgba(241, 176, 71, 0.13)';

// The same two amber at roughly half alpha, for a region that is set but not
// repeating — "toggling off must not look like losing the region", so the
// region stays visible and only its weight drops. Not separate tokens
// because they are not separate colours: same hue, same surface, one
// dimension (alpha) moved, which is exactly what the palette means by "off
// states lose colour, they never gain a different one".
export const LOOP_REGION_FILL_OFF = 'rgba(241, 176, 71, 0.14)';
export const LOOP_REGION_WASH_OFF = 'rgba(241, 176, 71, 0.06)';

// The scrim over everything *outside* the region, so the loop reads as the
// focus. Not a new colour either: it is --surface-well (#111316), the well
// the waveform already sits in, at the alpha that leaves the waveform
// beneath showing at the 32% the design specifies.
export const OUTSIDE_LOOP_SCRIM = 'rgba(17, 19, 22, 0.68)';
