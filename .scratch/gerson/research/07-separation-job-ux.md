# 07 — Separation job UX

## The constraints this design is built around

From ticket 01, measured rather than assumed:

- **~9 minutes** for a 7-minute song across 8 workers on desktop.
- **~2.3 GB peak RSS per worker**; roughly one worker per 4 GB of device RAM.
- Progress is **real**: demucs.cpp emits `{msg:'PROGRESS_UPDATE', data: 0..1}` from C++ via `EM_JS`.
- iPhone WebContent limit is **~1.5 GB** — below one worker's peak.

And a platform fact: **Web Workers die with the page.** No Service Worker can hold multi-minute
inference. So a separation cannot outlive its tab, and no design can pretend otherwise.

## Decisions

### The app stays fully usable during a job

Browse the library, open another Song, practise against it — all available while a Separation runs.
Nine minutes is far too long to hold the app hostage.

**The honest cost, which the app must not hide:** inference and playback compete for CPU and RAM.
Audio may glitch while a job runs. This is stated in the UI where it matters (on starting a job, and
on the transport of a Song opened during one) rather than left for the user to diagnose. It is not
framed as an error — nothing is broken.

### One Separation runs at a time; the rest queue

Dropping in five songs creates five Separations. The first runs; the others wait, each showing its
queue position. Any of them can be reordered or cancelled.

Running two at once is not a real option: worker count is memory-bound, so two concurrent jobs each
get half the workers and both take roughly twice as long. No throughput is gained and peak memory
doubles.

The total is stated up front — five songs is most of an hour — so "set it going and walk away" is an
informed choice rather than a surprise.

**Worker count is not user-facing.** It is inferred from device memory. Exposing it would surface an
implementation detail as a setting most people cannot judge.

### Interrupted jobs ask before restarting

A `running` Separation whose worker is gone reverts to `queued` and is shown as **interrupted**.
Reopening Gerson does *not* silently restart it. The user is told plainly that resuming means
starting over, and roughly how long that takes, then chooses to resume or discard.

The uploaded bytes are already in OPFS (ticket 05's schema), so resuming never needs a re-upload.

**True mid-inference resume is rejected**, not overlooked: it would mean checkpointing partial model
output per segment, which is real engineering and fights the memory ceiling, since the checkpoints
are themselves large.

Rationale for asking rather than auto-restarting: opening the app to check something should never
silently commit the machine to nine minutes of full-tilt CPU. On a laptop that is rude, and it is
exactly the kind of thing that gets a tool closed for good.

### Cancellation is always available

Both running and queued Separations can be cancelled. Cancelling terminates the workers, deletes the
Separation and its uploaded bytes, and leaves nothing behind — consistent with ticket 05, where a
Separation that does not succeed leaves no trace.

*(Decided directly rather than put to the user: a queue that cannot be cancelled from is a trap, and
ticket 05 already fixed what a non-succeeding Separation leaves behind, which is nothing.)*

### Mobile refuses up front

On a device detected as mobile, dropping in a song does **not** start a separation. Gerson explains
that separation needs a desktop, and offers the supported path: separate on desktop, export the
stems, import them here (ticket 12).

Never start a job that is expected to die. 2.3 GB per worker against a ~1.5 GB tab limit is not a
risk, it is a prediction.

**Known imperfection, accepted:** `navigator.deviceMemory` does not exist in Safari, so the signal is
effectively a mobile user-agent. This will over-refuse a capable tablet. Judged the better error —
refusing a device that might have worked costs one disappointed user a workaround they already have,
while attempting on a device that cannot costs battery, minutes, and a crash.

## Progress display

Progress is genuine, so it is shown as a real percentage with no invented smoothing. Alongside it:
which Song, its position in the queue, and a cancel control. Because the app remains usable, the
indicator lives somewhere persistent rather than on a dedicated screen — exact placement is a design
question for the Claude Design session, not a decision here.

## Deliberately not decided here

- What a **failed** Separation looks like, and whether it is auto-deleted or kept for inspection →
  **ticket 11**.
- The precise wording of the mobile refusal and the glitching-audio notice → **ticket 11**, which
  owns the failure surface and its language.
- Where the progress indicator physically sits → Claude Design.
