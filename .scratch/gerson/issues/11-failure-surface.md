# 11 — What does the user see when things fail?

Type: grilling
Status: resolved
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

## Answer

Resolved by grilling. **Mobile went out of scope for this map during this session** (see the map's
Out of scope), which cut the largest part of this ticket away rather than answering it: failure mode
1 no longer exists here, and mode 5's platform bands collapsed to a single desktop policy. What
follows is the desktop failure surface.

The governing principle throughout, carried from the map: **honesty over optimism, and refuse early
wherever the cost of finding out late is high.** Two guards below are worth more than all the
wording combined, because both sit in front of a nine-minute job.

### 0. Scope change made in this session

Mobile is out of scope. Consequences recorded on the map: **ticket 13 closed out of scope** (it
existed only to verify five iOS behaviours, and was one of four blockers on 09), and **ticket 12
re-justified on non-phone grounds** — it stays, because export/import is the only way a library
moves between machines with sync permanently out of scope, and because role assignment is a real
unsolved problem 14 handed it.

Decisions already banked were **kept, not unwound** — 07's mobile refusal is one guard clause
already decided, and 08's OPFS weight storage is correct on desktop regardless. Ripping them out is
work, not savings.

### 1. Playback memory — computable cost, one desktop budget

The key reframing: **playback cost is exactly computable before decoding a byte.** 14's 311 MB for
4 minutes stereo is **~78 MB/min** (4 stems x 2ch x 4 bytes x 44,100); mono is ~39 MB/min. What is
unknowable is the device budget — `navigator.deviceMemory` is absent in Safari (07 hit this) and
`performance.memory` is Chrome-only. So policy is driven by the half we know exactly, not by device
introspection.

**Desktop budget: 2 GB** — a 25-minute track still plays in stereo, so in practice this never fires.
That is the intent: desktop has swap and a browser that throws catchable errors, so the machinery
should not nag people who do not need it.

- **Under budget** — proceed silently, stereo. No message.
- **Over budget** — **warn and attempt**, stating the computed number. Never a hard refusal: unlike
  a job that is *known* to die, here we may simply be wrong about the budget.
- **Mono is always available as a manual override** — half the memory, a mild loss when practising
  against stems.

**Mono is a playback-time downmix, not a storage format.** Stems stay stereo FLAC exactly as 03
decided; the downmix happens after decode, before `addBuffers`. 03 is untouched, the toggle is
reversible without re-encoding, and the choice can differ per device for the same library.

**Load stems sequentially — transfer and drop each before decoding the next.** 06 found the decoded
`AudioBuffer` and the worklet copy are both resident until the transfer detaches the source, so a
parallel load spikes to steady-state plus four; sequential keeps the spike one stem wide
(~19 MB/min).

*(Originally specified per-platform bands with a 600 MB mobile constant and automatic mono fallback.
Removed with mobile.)*

### 2. Decode failure — name the browser, not the file

04 established there is no static format list — detection is **"try the decode"** — and the failures
are **browser-specific, not file-specific**: ALAC decodes only in Safari, Ogg only from Safari 18.4,
Chrome's AAC is MP4-only and Main-Profile-only and absent from some Chromium builds.

That asymmetry is the entire design problem. **"Unsupported file" is actively false** — the file is
usually fine, this browser cannot read it, and the user's other browser probably can. Saying it
sends people off to re-encode something that did not need re-encoding.

- **Never advertise a format list.** The picker accepts `audio/*`. Any list we print is a lie on some
  browser — promising AAC to a Chromium build that lacks it, or refusing an ALAC file Safari opens.
- **Decode is the first step, so failure costs seconds, not nine minutes.** The PCM is needed to feed
  Demucs anyway, so the guard is free. **No Separation is enqueued before its file has decoded** —
  the ordering is load-bearing and belongs in the spec.
- **The message names the browser and offers the two things that work**: *"Firefox couldn't decode
  this file. Its format isn't supported here — the same file may open in another browser, or you can
  convert it to WAV or FLAC, which work everywhere."*
- **No container sniffing to predict the failure.** 04 showed the browser's own decoder is the only
  reliable oracle; a sniffer adds a second, wrong opinion.

### 3. Storage — three situations, three treatments

**Full, before a job → refuse up front.** The write lands at the *end* of a nine-minute separation,
the worst possible moment to fail: maximum work, total loss. **Call `navigator.storage.estimate()`
before enqueuing**, compare free space against the known result size (03: ~93 MB of stems plus the
retained Recording), and refuse if it will not fit. Same principle 07 applied to mobile — never start
a job that is expected to die.

**Chrome's ~300 MB cap → a misconfigured browser, not a storage error.** 03 found this is what you
get when the browser clears site data on close; it holds **1.6 songs**, so the library is broken by
design and every second separation fails. Detect the small quota at startup and say **once** that the
browser is set to clear site data on exit, that Gerson can hold about one song under it, and where
the setting lives. **`persist()` is called at first save**, and a refusal folds into this same
conversation rather than being a separate one.

**Evicted, after the fact → one origin-level event, not N broken songs.** The catalogue is IndexedDB
and the bytes are OPFS (03), so the honest detection is a **startup reconciliation**: catalogue rows
whose files are gone. Reported once — *"Your browser cleared Gerson's stored audio. 6 songs need to
be separated again."* — because eviction is origin-wide, so it is one cause, and six identical
errors would misrepresent it as six problems.

**Schema consequence**: 05's rule is *if it is in the library as a Song, it plays*. A Song whose
files vanished violates it, so **reconciliation removes the rows — no tombstones, no re-separable
stubs.** The library shrinks and the user is told why. The Recording cannot rescue them; it was
evicted too.

### 4. Model download interrupted — scoped, atomic, verified

08 settled the policy (80.1 MB, fetched on first separation with consent, stored in OPFS). What
happens when it fails:

- **It is not fatal, and must not be presented as fatal.** A failed model download blocks
  **separation only** — the existing library still plays, exports, and works offline. "Gerson failed
  to load" would be false and would scare people off an app that is at that moment almost entirely
  functional.
- **No resume.** Range requests and partial-file bookkeeping are real complexity for an 80 MB fetch.
  Retry from zero.
- **Atomicity and verification instead.** Download to a temporary OPFS name, **verify before the
  rename** — length at minimum, ideally a hash pinned in the build — and rename only on success. A
  truncated file that passes for a model is far worse than a failed download: it surfaces later as
  garbage output or a crash deep inside WASM, where nothing can attribute it.
- **Real byte progress** (`Content-Length` is known — same honesty rule as 07's progress), and
  **manual retry**. No silent auto-retry storm on a connection the user consented to use once.
- **"Model present" is a three-valued app state** — absent / downloading / ready — read by the
  separation entry point. Same shape as 08's consent gate, so they compose.

### 5. A failed Separation persists until dismissed

05 makes this cleaner than it looks: a **Separation is a separate noun**, not a Song with a status,
so **a failure never produces a broken Song**. Only the Separation's fate is in question.

**It persists, visibly, until dismissed. Never auto-deleted.** The reason is the nine minutes: a job
that consumed nine minutes and vanished without trace is indistinguishable from one never started,
and the user's likely next move is to drop the same file and burn nine more on the same failure.
**The wreckage is the message.**

It holds **the cause, the timestamp, and the Recording** — keeping the Recording makes retry one
click rather than "find that file again", and it is already paid for (05 retains it, and identity is
the content hash, so a retry is recognisably the same work).

Two controls only: **Retry** and **Dismiss** (deletes the Separation and its Recording).

**Causes are named, not generalised**, because they lead to different actions:

| cause | what it suggests |
|---|---|
| worker crash / out of memory | close other tabs or apps, retry |
| storage write failure at the end | the storage conversation above; retryable once space exists |
| **cancelled** | **not a failure at all — reads as cancelled** |

That last row matters: 07 made cancel work everywhere, and a cancelled job shown in red as an error
would misreport the user's own deliberate action.

### 6. The CPU contention notice (deferred here by 07)

A plain statement attached to the running job, **not a warning**: *"Playback may stutter while a
separation is running."* It is the consequence of a decision the user made — 07 chose to keep the app
usable during a job and to state the contention rather than hide it — so it is stated once, in
neutral language, and is not an error.
