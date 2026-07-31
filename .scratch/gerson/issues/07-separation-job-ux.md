# 07 — How does a multi-minute separation job behave?

Type: grilling
Status: resolved
Blocked by: 01

## Question

Separation takes minutes. That is a long time for a web app to be doing something, and the design
of that wait is a real product decision, not an afterthought.

Walk:

- **Progress**: does the chosen runtime (01) expose real progress, or only chunk counts? If progress
  is fake, is a fake progress bar acceptable, or is an honest indeterminate state better?
- **Cancellation**: can a job be cancelled mid-flight, and what state does the song end in?
- **Navigation**: can the user browse the library, or play an already-split song, while another one
  separates? Or is the app modal during a job?
- **Tab close / reload mid-job**: is progress checkpointed and resumable, or is the work lost and the
  song reset to "uploaded"? Recommend — resumability may be disproportionately expensive.
- **Queueing**: can more than one song be queued, or is it strictly one at a time? (Memory from 01
  probably forces one at a time — confirm.)
- **Mobile failure**: research on 01 hardened this considerably. Peak RSS is **~2.3 GB per worker**
  against an iPhone WebContent limit of **~1.5 GB**, and freemusicdemixer forces a single worker on
  mobile. So mobile separation is not "best-effort" — it is **expected to fail**. Decide whether
  Gerson should detect the device and **refuse up front**, pointing at the import path (ticket 12),
  rather than letting the user wait ten minutes for an OOM. Recommend refusing.

## Facts research already supplied

- **Progress is real, not faked**: demucs.cpp already posts `{msg:'PROGRESS_UPDATE', data: 0..1}`
  from C++ via `EM_JS`. The "is a fake progress bar acceptable" question is moot — drop it.
- **Timing to be honest about**: ~9 minutes for a 7-minute song across 8 workers on desktop.
- **Worker count is memory-bound**: one worker per 4 GB of device RAM. Whether Gerson exposes this
  or infers it silently is a decision for this ticket.

## Answer

Full reasoning: [research/07](../research/07-separation-job-ux.md).

- **The app stays fully usable during a job** — browse, open another Song, practise. Nine minutes is
  too long to hold hostage. The cost is stated openly rather than hidden: inference and playback
  compete, so audio may glitch during a job. Said in the UI, framed as expected, not as an error.
- **One Separation runs at a time; the rest queue.** Five songs dropped in = five Separations, first
  running, others showing queue position, all reorderable and cancellable. Concurrency is pointless
  here — worker count is memory-bound, so two jobs each get half the workers and both take twice as
  long, at double the peak memory. Total time stated up front.
- **Worker count is inferred from device memory, not user-facing.**
- **Interrupted jobs ask before restarting.** Workers die with the page (no Service Worker can hold
  multi-minute inference), so a `running` Separation reverts to `queued`, shows as *interrupted*, and
  waits. Resuming means starting over and says so. Never silently commits the machine to nine minutes
  of CPU because someone opened the app to check something. Uploaded bytes stay in OPFS, so no
  re-upload. True mid-inference resume rejected on cost — per-segment checkpoints are large and fight
  the memory ceiling.
- **Cancel works on running and queued alike**, deleting the Separation and its bytes. *(Decided
  directly, not asked: a queue you cannot cancel from is a trap, and 05 already established a
  non-succeeding Separation leaves nothing behind.)*
- **Mobile refuses up front** and points at import. 2.3 GB per worker against a ~1.5 GB tab limit is
  a prediction, not a risk. Accepted imperfection: Safari has no `navigator.deviceMemory`, so the
  signal is a mobile user-agent and will over-refuse a capable tablet — judged the better error.
- **Progress is real** (demucs.cpp emits 0..1), so it is shown as a true percentage with no invented
  smoothing. The ticket's "is a fake progress bar acceptable" question was moot and is dropped.

Passed to **ticket 11**: what a failed Separation looks like, and the wording of the mobile refusal
and the glitching-audio notice.

