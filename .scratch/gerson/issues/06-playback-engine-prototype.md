# 06 — Prototype: do 4 stretched stems stay in sync?

Type: prototype
Status: open
Blocked by: 02, 04

## Question

The single biggest technical risk in the player. Build a throwaway prototype (via `/prototype`,
under `prototype/`, not app code) that proves or kills the playback architecture.

It must demonstrate, with 4 real stem files:

1. Four stems playing **sample-locked** together, with per-stem gain and mute/solo applied live.
2. Global time-stretch at **0.5x, 0.75x, 1x, 1.5x** with pitch preserved — and stems still locked
   after several minutes of playback (drift is cumulative; a 10-second test proves nothing).
3. **Seeking** to an arbitrary position with all four stems landing on the same sample.
4. A **loop region** that repeats cleanly — no click, no drift accumulating across loop iterations.
5. Toggling mute/solo and changing tempo **mid-playback** without a glitch or a resync.

Record the CPU cost with all four running, and the behaviour when the tab is backgrounded.

The decision this resolves: whether the architecture is 4 independent stretchers on a shared clock,
a single stretcher fed by a live pre-mix, or something else. If sync can't be made solid, that is a
finding worth having early — say so plainly rather than papering over it.
