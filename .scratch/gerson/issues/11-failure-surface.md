# 11 — What does the user see when things fail?

Type: grilling
Status: open
Blocked by: —

## Question

Graduated from fog: research has now made the failure modes concrete and named, so they can be
designed rather than hand-waved.

The known failure modes, each with a real cause found in research:

1. **Separation cannot complete on mobile** — ~2.3 GB peak RSS per worker against an iPhone
   WebContent limit of ~1.5 GB. This is not an edge case; it is the expected mobile outcome.
2. **Decode fails on an accepted-looking file** — there is no static format list, detection is
   "try the decode". ALAC works only in Safari; Ogg only from Safari 18.4; Chrome's AAC is
   MP4-only, Main-Profile-only and missing entirely from Chromium builds.
3. **Storage is full or evicted** — including Chrome's ~300 MB cap under "clear site data on close"
   (holds 1.6 songs), and iOS 7-day eviction if the app was never installed to the Home Screen.
4. **The model download is interrupted** — 80.1 MB, and nothing works without it.
5. **Playback runs out of memory** — four buffers is 339 MB for a 4-minute song.

For each: what the user is told, in what words, and what they are offered instead. The standing
principle from the map is honesty over optimism — a spinner that never resolves is the failure to
avoid.

Also decide: which of these are **preventable by refusing early** (e.g. checking device memory and
declining to start a separation on mobile, rather than OOMing 10 minutes in) versus reported after
the fact. Refusing early is usually kinder and is specifically right for #1.

## Sharpened by ticket 14

Failure mode 5 (playback memory) got worse and more concrete. **Windowed loading is not available** —
`signalsmith-stretch` breaks silently on multi-chunk feeds — so the floor is **311 MB for a 4-minute
song**, stereo, and it scales linearly with length. A 10-minute track is ~800 MB.

So this ticket must decide:
- At what track length does Gerson **warn or refuse** rather than attempt playback?
- Is **mono playback** (155 MB, half the cost) offered as an explicit user choice, an automatic
  fallback on constrained devices, or not at all?
- What the user sees when a song loads but playback cannot be sustained — noting this is now the
  *likely* mobile outcome for long tracks, not an edge case.
