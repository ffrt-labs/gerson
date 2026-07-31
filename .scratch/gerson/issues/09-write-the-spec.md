# 09 — Write the build-ready spec

Type: grilling
Status: open
Blocked by: 10, 11, 12, 13

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
