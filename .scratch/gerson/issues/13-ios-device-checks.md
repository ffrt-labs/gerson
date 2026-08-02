# 13 — Verify five iOS behaviours on a real device

Type: task
Status: closed — out of scope
Blocked by: —

## Closed: out of scope

Closed while working ticket 11, when **mobile was ruled out of scope for this map**. Every item here
exists only to select an iOS fallback path, so with no iOS target there is nothing to verify and
nothing downstream waiting on the answers.

This unblocked the destination: 13 was one of four blockers on 09, and the only ticket no agent
could clear — item 5 alone needed a week of wall-clock with a real device.

The questions are not wrong, just not on this route. If mobile is ever redrawn into scope, this
returns as a fresh effort, not a resumption.

## Question

Nothing to decide — these are facts that research explicitly could not establish from any source,
and each one selects which fallback path Gerson ships. They need one manual session on a real
iPhone. HITL: the agent cannot do this.

Ticket 04 flagged all of these as "not found":

1. Does `<a download>` work in an **iOS standalone-mode PWA** (added to Home Screen), or only in
   Safari proper? If not, `navigator.share({files})` becomes the only export path on installed iOS.
2. Does iOS handle **four sequential programmatic downloads**, or does it drop all but the first?
   Decides whether multi-stem export must be a single zip on iOS.
3. Does WebKit **spill large blobs to disk**, or hold them in memory? Decides whether a 169–424 MB
   zip can be materialised at all on a phone.
4. What is the real **peak memory ceiling** for a WebContent tab on the target device, measured
   rather than quoted from a bug tracker — does a 4-minute four-stem session (339 MB) survive
   playback?
5. Does the **Home Screen install actually exempt** the origin from 7-day eviction in practice?
   Verify by installing, leaving the device untouched past 7 days, and reopening.

Item 5 takes a week of wall-clock, so start it first and let it run while other tickets proceed.

Record the answers here; several feed 11 and 12 directly.
