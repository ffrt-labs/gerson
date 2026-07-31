# 10 — How are four waveforms drawn and kept smooth?

Type: grilling
Status: open
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
