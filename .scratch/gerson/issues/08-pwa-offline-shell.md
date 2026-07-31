# 08 — What does "works offline" actually mean for the shell and the weights?

Type: grilling
Status: open
Blocked by: 01

## Question

The app shell is small; the model weights are not. Offline-first has to account for both.

Walk:

- **Weight caching**: where do the model files live — Cache Storage via the service worker, OPFS
  alongside the stems, or bundled into the build? Bundling hundreds of MB into a static build is
  almost certainly wrong; confirm and rule it out explicitly.
- **First run**: is the model downloaded eagerly on first load, or lazily on first separation?
  What does the user see while several hundred MB arrive, and what happens if it's interrupted?
- **Offline definition**: after first successful load + model download, does *every* feature work
  with the network off — including a cold start of an installed PWA? That is the claim; verify what
  would break it.
- **Updates**: how does a new app version reach an installed PWA, and does a version bump invalidate
  the cached weights? (It must not, unless the model itself changed.)
- **Install**: manifest, icons, and what the installed experience is on desktop vs iOS — note iOS
  PWA storage eviction behaviour, which interacts badly with the library from 03.
