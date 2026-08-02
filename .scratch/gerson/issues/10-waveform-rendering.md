# 10 — How are four waveforms drawn and kept smooth?

Type: grilling
Status: resolved
Blocked by: —

## Question

Graduated from fog once 03 settled the peak format.

**Already decided by 03**: peaks are Int8 min/max pairs at 256 samples/pixel, ~82.7 KB per stem,
computed once and stored alongside the stem.

Still open:

- **Render target**: canvas 2D per track, one shared canvas, or WebGL. Four tracks plus a playhead at
  60fps is the bar. Recommend based on what 06 measures — it will already know the CPU headroom left
  after four stretchers.
- **Zoom**: is the timeline fixed to fit-the-song, or zoomable? Zoom means peaks at multiple
  resolutions or on-the-fly recomputation, and it interacts with how precisely a loop region can be
  placed. Recommend a position; this is a scope call as much as a technical one.
- **Playhead**: drawn into the same canvas per frame, or a separate compositor-friendly layer? The
  latter avoids redrawing 4 waveforms every frame.
- **When are peaks computed** — during separation while the PCM is already in memory, or lazily on
  first open? The former is nearly free; the latter costs a full read.
- **Loop region affordance**: what the drag interaction is on top of the waveform, and whether it
  snaps to anything given there is no beat grid (BPM detection is out of scope).

Note: visual *design* is Claude Design's job. This ticket decides the rendering architecture and the
interaction model, not the look.

## Answer

Resolved by grilling. Nothing here needed new research — 02 had already specified the playhead
source, and 03 had already fixed the peaks format and shown that peaks can be built in a streaming
pass at import time. The work was choosing an interaction model and confirming the per-frame budget.

### 1. Zoom — zoomable, one stored resolution

**Zoomable timeline**, but with the cheapest possible model: **one stored peaks resolution, never
several.** Zooming out aggregates the same Int8 array on the fly (min of mins, max of maxes).
Zooming in stops at **1 pair per pixel = 5.8ms/px**. No second peaks format, no PCM re-read, no
extra storage.

Fit-the-song was rejected on a number: at 256 samples/px the stored peaks are 172 px/second, so a
4-minute song is 41,344 pairs. Fitting that to a ~1200px timeline discards 97% of what was stored
and makes **one pixel = 0.2 seconds** — roughly a sixteenth note at 120bpm of slop on *each* loop
edge, with no beat grid to snap to. That is not precise enough to loop a lick, which is the app's
core gesture.

Zoom range: minimum is fit-the-song, maximum is 1 pair/px.

### 2. Viewport — static, with a sweeping playhead

The viewport **holds still and the playhead sweeps across it.** Auto-follow only when the playhead
leaves the viewport. Any user interaction — a loop drag, a pan, a zoom — **defeats follow until
re-armed**, or the view yanks itself away mid-drag.

Continuous scroll (waveform sliding under a fixed centre playhead) was rejected for two reasons.
Cost: it animates all four waveforms every frame forever, and the rescue — an offscreen canvas
blitted per frame — is **~53 MB at max zoom** (41,344 px wide x 4 stems) on top of the 311 MB
playback floor that ticket 14 established as unavoidable. Fit: Gerson's core loop is repeating a
short region, and inside a loop that region is stationary and on screen — a scrolling view would
animate constantly to show you the same 8 bars.

**This decision is what makes everything below cheap.** Between gestures the waveforms are static
bitmaps; nothing animates except the playhead and, during a drag, the loop edges. The 60fps bar
applies to a line, not to four waveforms.

### 3. Render target — canvas 2D, four canvases + one overlay

**Four canvas 2D elements, one per stem row, plus one absolutely-positioned overlay canvas spanning
all four rows** for the playhead and the loop region. Every canvas sized to `devicePixelRatio`, or
the waveforms are visibly soft on most displays.

A waveform redraw is one path of ~1200 vertical segments from the Int8 min/max pairs — low
single-digit ms, and it happens on a user gesture, not per frame. **WebGL buys nothing** and costs
shaders, context loss handling, and a fallback path.

Per-track canvases rather than one shared canvas, because track state changes independently —
muting bass redraws bass alone — and each row stays a normal DOM element that Claude Design can
style and size without the layout living in canvas coordinate math.

The overlay spans all four rows rather than a playhead per canvas, because the playhead and the
loop region are **song-level, not track-level** (matching 05, which persists one loop region per
Song). One line, one shaded rect, drawn once per frame across the stack. The 60fps path never
touches a waveform bitmap.

### 4. Peaks are computed eagerly, with a repair path

Peaks are computed **at the moment the stems are produced**, in the streaming pass while the PCM is
already decoded and on its way to the FLAC encoder — marginal cost ~zero. They are written **in the
same commit as the stem files**, ahead of the catalogue record (03 fixed the order: files first,
record last). So *a Song in the library implies its peaks exist*, matching 05's principle that a
Song in the library is one that plays. Lazy-on-first-open was rejected: it costs a full FLAC decode
of four stems to draw a picture.

**Repair path**: if a peaks file is missing or its length does not match the stem, recompute it on
open from the stored FLAC. Peaks are regenerable data; partial eviction should cost seconds of
decode, not the Song.

**Constraint handed to 12**: imported stems get their peaks computed during import, in the same pass
that decodes them to verify they are valid audio.

### 5. Four rows. The Recording is not a lane.

**No fifth waveform for the original Recording.** It is visually redundant (the four stems sum to
approximately the original), expensive (a fifth `signalsmith-stretch` node and buffer is +78 MB
against a 311 MB floor that is already a live mobile risk), and it muddies the model — 05 made a
Song exactly four Stems with fixed Roles, and a fifth pseudo-track with a waveform but no Role is a
special case in both schema and UI.

If reference-mix A/B ever ships it is a **swap** — mute the four, play the Recording in their place,
reusing the transport — not a fifth lane. **Noted for 09 as unspecified**, not designed here.

### 6. Loop region — a dedicated lane, and no snapping

**A dedicated loop lane running the full width of the timeline, above the four tracks and
pixel-aligned with them.** Drag in the lane creates a region; its edges drag there; dragging its
middle moves it without resizing. The region is **shaded down through all four waveforms** by the
overlay canvas — visible everywhere, draggable only in the lane. The waveforms keep one unambiguous
gesture: **click to seek.**

Drag-on-waveform was rejected because seek and loop would compete for the same surface, forcing a
drag-threshold heuristic that is most ambiguous when the drag is short — which is the common case.
The lane is the Logic/Ableton loop brace, needs no heuristic, and gives the time labels a home.

**Nothing snaps, and no grid is invented.** There is no beat grid (BPM detection is out of scope),
and zero-crossing snap is meaningless across four stems that cross at different times. Precision
comes from three other places instead:

1. **Zoom** — 5.8ms/px at the limit, so the drag itself is precise once zoomed in.
2. **Set loop start / end from the playhead** — place an edge by ear rather than by eye.
3. **A numeric readout** of start / end / length, nudgeable.

That trio is what a practice tool actually needs: you find the edge by listening, not by pointing.

### 7. Playhead — main-thread arithmetic, latency-compensated

Confirms 02 §5: position is **computed on the main thread from the same `{input, output, rate}`
transport anchor against `audioContext.currentTime`**, not read from the worklet. `stretch.inputTime`
via `setUpdateInterval()` was rejected — it is message-driven with a 0.05s floor (ticket 14 saw that
floor as ~2205 samples of apparent spread), and a 20Hz playhead visibly stutters against a 60fps
repaint. As arithmetic it stays correct through a rate change the instant the anchor is replaced.

Two wrinkles that must be in the spec, because they are where this goes wrong:

- **Loop wrap**: the worklet wraps `inputTime` by subtracting the loop length past `loopEnd`. The
  main-thread mapping must apply the **same wrap**, or the drawn playhead sails off screen while the
  audio correctly repeats.
- **Latency**: the worklet's mapping describes what it is *rendering*, heard `outputLatency` later.
  Evaluate the playhead mapping at **`currentTime − outputLatency`** so the line sits on what is in
  your ears, not what is in the buffer. Tens of ms — small, but visible against a transient at 0.5x.

### 8. One timeline on every platform

**Same architecture, same four rows, no separate mobile renderer.** Memory is not the constraint: at
DPR 3 a 390px-wide, 60px-tall row is a 1170x180 backing store (~0.84 MB), so four rows plus overlay
is under 5 MB. No DPR cap needed.

Phone playback is **first-class, not degraded** — 07 makes mobile refuse separation and 12 makes
import the only way a song reaches a phone. What breaks there is *pointing precision*, not pixels:
at 390px, fit-the-song on a 4-minute track is 0.6 s/px against a ~40px fingertip, so an untouched
loop drag has seconds of slop. Three touch requirements follow:

- **Pinch to zoom, drag to pan** — no wheel, no modifier keys.
- **~20px hit slop on loop edges** — they draw as hairlines but must grab from either side.
- **Set-from-playhead is the *primary* loop-setting path on touch**, not a fallback. Tapping "set
  loop start" while listening is precise at any screen width; dragging never is. This makes the
  numeric / from-playhead controls **load-bearing, not a power-user extra Claude Design can drop.**

### 9. Rendering stays on the main thread

**Main thread, with a two-phase gesture strategy — not OffscreenCanvas in a worker.**

Redraws are gesture-driven, so the main thread is idle almost always. The one exception is a
continuous pinch-zoom or pan, where every gesture frame would re-aggregate and re-path four
waveforms — worst on a phone, where the CPU is weakest and the gesture most common. The fix is not a
worker: **while a gesture is in flight, `drawImage` the existing bitmap scaled and translated to the
new viewport** — one GPU-friendly blit per row, slightly soft while fingers are moving, which nobody
notices mid-gesture — then **re-render sharp from the peaks on gesture end.**

This keeps the renderer synchronous and adds no worker to a system already running N separation
workers and four AudioWorklets. **OffscreenCanvas stays a documented escape hatch** if a real device
proves the blit insufficient; the swap is local to the render function, since nothing else touches
the canvases.
