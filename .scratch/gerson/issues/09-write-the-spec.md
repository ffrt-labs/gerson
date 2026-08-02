# 09 — Write the build-ready spec

Type: grilling
Status: resolved
Blocked by: — (10, 11, 12 resolved; 13 closed out of scope with mobile). **Unblocked.**

## Question

The destination. Once every ticket above is resolved, fold the decisions into a single spec at
`.scratch/gerson/spec.md` that a fresh session can build from without re-litigating anything.

It must state:

- The domain model and persisted schema (from 05)
- The separation pipeline end to end: file in → decode → worker → 4 stems → storage (01, 03, 04, 07)
- The playback architecture, as proven by the prototype (02, 06)
- The offline/PWA contract and the weight-caching strategy (08)
- The feature list with explicit non-goals, carried from the map's Out of scope
- The UI surface described as *behaviour and state*, not visual design — Claude Design owns the look,
  and the spec should hand it a clean list of what must be controllable and what must be displayed
- Known limits stated honestly: processing time, storage cost, mobile separation being best-effort

Two build-time notes surfaced by research that belong in the spec and would otherwise be lost:

- **Vendor `demucs.cpp` at a pinned commit.** Last pushed 2024-12-01 — complete and dependency-light,
  but 20 months stale. Do not track its default branch.
- **`signalsmith-stretch` has no TypeScript types** (open issue #26; the author asked for help).
  Budget a hand-written `.d.ts`.

Resolved when the spec is written and the user agrees nothing is left to decide.

## Answer

**The spec is written: [`../spec.md`](../spec.md).** Thirteen sections, folding all fourteen tickets
into one document a fresh session can build from.

Most of this ticket was folding, not deciding — but grilling surfaced **six decisions nothing else
owned**, plus a handful of smaller calls made in the writing.

### The six decisions

1. **Reference-mix A/B is a named non-goal** — the last thing parked in the map's fog. A fifth
   stretcher node and buffer is +78 MB against 14's unavoidable 311 MB floor, and 12's summed
   Recordings mean "compare against the original" would sometimes be a lie. Cheap to add later; the
   transport already exists.
2. **Mobile: keep the guard, drop the UX.** 07's user-agent refusal ships — it sits in front of a
   job that is *known* to die, and costs one check. Everything else mobile-shaped is now explicitly
   not built: iOS install onboarding, the 7-day-eviction acknowledgement, pinch/touch hit-slop,
   responsive player layout. 10's set-from-playhead controls still ship, because they were justified
   on **precision, not touch**.
3. **One spec, four phases** — pipeline+library → player → export+import as one unit → PWA/offline.
   Nothing cut. The failure surface is deliberately *not* a phase: each guard ships with the code
   path it guards.
4. **Two surfaces plus a persistent job affordance.** Library and Player navigate between each
   other, with running/queued Separations visible from both. This is what makes 07's "the app stays
   usable during a nine-minute job" real without the player surrendering horizontal width — which
   10 established is exactly what buys loop precision. Import mapping is a modal over the Library.
5. **Weights are served from the app's own origin**, excluded from the precache manifest, pinned by
   a build-time SHA-256. 08 settled that weights land in OPFS but never fixed where they are
   *fetched from* — and the offline claim depends on that being one host, not two. The pinned hash
   is what gives 11's verify-before-rename something to check against; without it that decision was
   inert.
6. **Export is FLAC by default on both commands, WAV a visible alternative on both.** Resolves the
   drift between 04 (WAV, dependency-free) and 12's amendment (tagged FLAC, for identity). The
   codec is already in the bundle for storage, so FLAC is free — and it makes the **default path
   also the path that round-trips**. Where WAV is offered, the tag-loss consequence is stated.

### Smaller calls made in the writing

- **Keyboard**: `space` play/pause, `[` / `]` set loop start/end from playhead, `L` toggle loop,
  arrows nudge the loop readout. 10 made set-from-playhead load-bearing, so it earns real bindings.
- **The mono override is a device-level `localStorage` preference, not part of `PracticeState`** —
  11 said the choice can differ per device for the same library, which rules out persisting it on
  the Song.
- Tempo is a slider plus numeric readout with reset-to-1×; nothing snaps. Library newest-first;
  titles editable; deleting a Song confirms and removes its OPFS files.

### One thing the ticket asked for that is now false

The ticket's own brief said to state "mobile separation being best-effort" among the known limits.
That wording predates 07 (mobile separation is *expected to fail*, not best-effort) and then 11
(mobile out of scope entirely). The spec says mobile is unsupported and separation refuses up front.
