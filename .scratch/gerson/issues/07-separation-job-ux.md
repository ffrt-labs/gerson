# 07 — How does a multi-minute separation job behave?

Type: grilling
Status: open
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
- **Mobile failure**: when the phone can't complete a separation, what does the user see and what
  are they offered instead? The phone-role decision already accepts best-effort; this designs the
  honest failure.
