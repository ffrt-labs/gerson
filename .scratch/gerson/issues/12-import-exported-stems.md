# 12 — How does importing an already-split stem set work?

Type: grilling
Status: open
Blocked by: —

## Question

Graduated from fog now that 04 has fixed the export format.

This is the **reliable phone path**. Research on 01 established that mobile almost certainly cannot
run separation at all (~2.3 GB peak vs ~1.5 GB limit), which promotes import from a nice-to-have to
the *only* way a song reaches the phone. It deserves proper design, not a hidden dev affordance.

Resolve:

- **What is imported** — four loose files the user selects, or a single container produced by
  "Export stems"? 04 recommends STORE-only zip on Chromium and separate downloads elsewhere, so the
  import side must accept both shapes.
- **Role assignment**: how does the app know which file is the bass? Filename convention from our own
  exporter, embedded metadata, or an explicit mapping UI on import. Recommend — and say what happens
  for a stem set that did *not* come from Gerson.
- **Validation**: identical sample rate, identical length, and what to do when they differ (reject,
  or pad/resample). Mismatched lengths break the shared clock 02 depends on.
- **Provenance in the domain model**: is an imported song distinguishable from a separated one, and
  does it matter? (Bears on 05 — it may need a `source` field.)
- **Partial sets**: is importing 2 of 4 stems legal, or is a complete set required?

## Sharpened by ticket 14

The prototype's stem-identification approach failed in practice and is a worked example of what not
to ship: it guessed roles by filename substring, and **silently accepted the original song as a
single "stem"** and played it. The user could not tell from the UI that anything was wrong.

So role assignment needs to be either explicit (a mapping UI) or verified (metadata written by our
own exporter), and import must **reject** rather than guess — with a visible reason. Add to the
validation list: a single file dropped where four are expected.
