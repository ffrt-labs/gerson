# Handoff: Gerson UI redesign

## Overview

Gerson is a local-first audio practice tool: you add a Song, it separates into four
Stems (vocals / drums / bass / other) on the user's own machine, and you practise
against them — muting parts, slowing down, looping a passage. Nothing is uploaded;
separation runs in a Web Worker in the tab.

The existing interface is unstyled developer scaffolding: `#111` background, native
`<input type="range">` faders, text-only `<button>`s, and four stacked waveform
canvases with a row of Gain/Mute/Solo controls underneath. It works, but you cannot
tell at a glance which controls are engaged, and the loop and tempo controls — the
reason the app exists — look identical to everything else.

This redesign gives it a deliberate visual system, a real button hierarchy, and a
Player laid out around practice rather than around separation. Two Player directions
were explored; **direction 1a "Stage" was chosen** and is the one to build. Direction
1b "Pedalboard" is left in the file for reference only — **do not build 1b.**

## About the design files

The files in `designs/` are **design references written as HTML**. They are prototypes
that show intended appearance, layout, states and control affordances. They are **not
production code and should not be copied into the app.** They use a small
authoring runtime (`support.js`) that has nothing to do with Gerson.

Your job is to **recreate these designs inside the existing Gerson codebase** — React
18 + TypeScript + Vite, plain CSS in `app/src/index.css`, no UI framework, no CSS-in-JS
— using its established patterns. Keep the app's existing architecture exactly as it is:

- The domain layer (`app/src/domain/`), separation engine (`app/src/separation/`),
  storage, export and waveform maths are **not part of this redesign.** Do not
  restructure them.
- `app/src/waveform/draw.ts`, `lane.ts` and `overlay.ts` already render waveforms
  correctly against `Int8Array` peak data. Keep that code; only the *colours,
  dimensions and composition* change (see "Waveform rendering" below).
- The redesign is presentational plus a small amount of new local component state
  (which drawer/sheet is open). No new domain concepts are introduced.

Open `designs/Gerson.dc.html` in any browser to see everything. The file is organised
newest-work-first: turn 2 (export, precision drawer, modals, mobile) is at the top,
turn 1 (the two Player directions and the Library states) below it. Each option carries
a visible id badge — `1a`, `1c`, `2a`, `2b`, `2c`, `2d` — and this document refers to
those ids. `designs/Gerson - Current UI.dc.html` is a faithful recreation of today's
interface, for before/after comparison.

## Fidelity

**High fidelity.** Final colours, typography, spacing, radii, shadows, hit-target sizes
and copy. Every value is in `tokens.css` with both `oklch()` and exact hex. Recreate
pixel-perfectly, but express it in the codebase's own idiom: plain CSS classes in
`index.css` following the existing `player-*` / `library-*` naming, not inline styles
(the prototypes use inline styles only because of how they were authored).

Two things are deliberately *not* specified and are yours to choose: the exact CSS
class names, and how you split components inside `app/src/components/`.

---

## Design system

### Type

Two families, strictly divided:

| Family | Used for |
|---|---|
| **Sora** (300–700) | All prose, labels, headings, button text |
| **JetBrains Mono** (400–700) | Every number, timecode, byte count, percentage, and all UPPERCASE LEGENDS |

A number never renders in Sora. This is what stops timecodes and gain values from
shifting width as they change — it replaces the current
`font-variant-numeric: tabular-nums` patches. Load both from Google Fonts (the app
currently loads no webfonts):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

The uppercase mono legend is a recurring device — `TEMPO`, `LOOP REGION`, `YOUR SONGS`,
`ON THIS DEVICE`. Always: JetBrains Mono, 10–11px, `letter-spacing: 0.14em–0.16em`,
`--text-meta`. It labels a region; it is never a sentence.

### Colour

Full palette in `tokens.css`. The three rules that carry the design:

1. **Lime (`--accent`) means engaged or primary.** The play button, the primary action
   in any sheet, an active Solo, Follow when on, the progress bar of a running
   separation. If it is lime, it is either the one action to take or a control that is
   currently ON. Never decorative.
2. **Amber (`--loop`) means loop, and only loop.** The loop region wash, the A/B
   markers, the Loop toggle when engaged, the loop chip in the export summary. Carried
   over from the current app's `#d9a441`. Because loop owns amber and playback owns
   lime, the two states never compete.
3. **Muted is amber too, but dimmed** — a muted stem gets an amber `MUTED` badge and a
   *desaturated* waveform (`--wave-muted`), not a lime one. Off states lose colour;
   they never gain a different colour.

Everything else is the neutral graphite ramp. Two background colours per screen
maximum, from the surface ramp.

### Buttons — the hierarchy that fixes "can't tell what's a button"

Four tiers, and the tier is legible from shape alone:

| Tier | Face | Border | Text | Use |
|---|---|---|---|---|
| **Primary** | `--accent` | none | `--on-accent`, 600 | One per screen: Add a song, Export mix, Download, Retry |
| **Secondary** | `--surface-control` | 1px `--border-raised` + `box-shadow: inset 0 1px 0 --highlight-inset` | `--text-primary`, 500 | Mute, Solo, Set A/B, steppers, Start over |
| **Ghost** | transparent | 1px `--border-control` | `--text-secondary`, 400 | Back, Rename, Dismiss, Cancel, Hide |
| **Engaged toggle** | `--accent` or `--loop` | matching | `--on-accent` / `--on-loop`, 600 | Any toggle that is currently ON |

The secondary tier's inset top highlight is what makes it read as a physical, pressable
face rather than a bordered div — keep it.

**Engaged states.** An engaged toggle changes *fill*, plus a 3px ring:
`box-shadow: 0 0 0 3px var(--accent-ring)`. It never signals state by border colour
alone (which is what the current UI does, and why it is unreadable). Every engaged
control also carries a word: `Loop on`, `MUTED`, `SOLO`, `REPEATING`.

**Icons + labels.** Every control has both, except icon-only buttons whose meaning is
unambiguous in context (back arrow, close, ±, stepper chevrons, transport skip).
Icons are **Material Symbols Rounded**, filled, loaded once:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0&display=block" rel="stylesheet">
```

Note: `app/public/icons.svg` in the repo is the leftover Vite-template social sheet and
is unrelated — ignore it. Glyph names used: `graphic_eq` (logo, bass, mix), `mic`
(vocals), `album` (drums), `piano` (other), `play_arrow`, `pause`, `replay_10`,
`forward_10`, `repeat`, `repeat_on`, `my_location`, `speed`, `volume_up`, `volume_off`,
`headphones`, `download`, `folder_zip`, `unarchive`, `cloud_off`, `cloud_download`,
`downloading`, `wifi`, `add`, `remove`, `close`, `edit`, `delete`, `refresh`,
`restart_alt`, `error`, `warning`, `info`, `pause_circle`, `check_circle`, `shield`,
`tune`, `keyboard`, `zoom_in`, `zoom_out`, `arrow_back`, `arrow_forward`,
`chevron_left`, `chevron_right`, `fast_rewind`, `fast_forward`, `first_page`,
`expand_more`, `keyboard_arrow_up`, `keyboard_arrow_down`, `folder_open`,
`library_music`, `schedule`, `smartphone`, `install_mobile`, `add_to_home_screen`,
`download_for_offline`, `battery_full`.

### Hit targets

Minimums, from `tokens.css`: transport play 62px desktop / 76px mobile, primary sheet
action 52px, stem Mute/Solo 46px, header and row buttons 44px, dense icon buttons 40px,
absolute desktop floor 38px. Mobile never goes under 44px.

### Layout

- App window: `--radius-frame`, 1px `--border-subtle`, `--shadow-window`.
- Header 64px, `--surface-raised`, 1px bottom `--border-subtle`, 20px horizontal padding.
- Status footer 48px, `--surface-well`.
- Sibling groups are laid out with flex/grid + `gap` — never margins between siblings.
- Body copy gets `text-wrap: pretty`.

---

## Screens

### 1a — Player, "Stage" (build this)

Design width 1280×840 in the mock; in the app it is fluid — the waveform and stem grid
take the extra width, the dock height is fixed.

**Purpose.** Practise against a separated Song: hear it, slow it, loop a bar, drop parts
out.

**Layout**, top to bottom:

1. **Header, 64px.** Ghost "← Library" (40px). Song title (18px/600, `--tracking-title`)
   with a mono meta line under it: `3:34 · 4 stems · 44.1 kHz`. Right side: the offline
   chip, then a secondary "Export" button (40px) that opens sheet 2a.
   - *Offline chip:* 32px pill, `--surface-card`, 1px `--border-subtle`, `cloud_off`
     icon in `--accent`, label `ON THIS DEVICE` (mono 11px, `--text-body`). This chip
     is the identity of the product, not a footnote — it appears on every screen.
2. **Waveform stage.** A caption row above it: legend `LOOP REGION` + the live values
   `1:18.40 → 1:36.20 · 17.80s` in `--loop`; right-aligned, an engaged-lime "Follow"
   toggle (34px) and a 2-button zoom cluster (36px each, joined, shared border).
3. **Waveform container.** `--surface-well`, 1px `--border-subtle`, `--radius-well`,
   `overflow: hidden`. Three stacked bands:
   - **Loop lane, 30px** — `--surface-raised`, 1px bottom border, `cursor: crosshair`.
     Canvas draws the region fill (`--loop-region-fill`). The A and B handles are
     **16px-wide amber divs containing their own letter**, flex-centred,
     `color: --on-loop`, mono 11px/700 — the letter must be a child of the handle, not
     a separately positioned span, or it drifts off the amber and becomes illegible.
     `cursor: ew-resize`.
   - **Waveform, ~316px** — one canvas showing the full mix, `cursor: grab`.
   - **Ruler, 26px** — `--surface-well` darker step, 1px top border, mono 10px
     `--text-tertiary` times every 50 seconds, plus a 2px lime playhead tick.
4. **Stem cards.** `grid-template-columns: repeat(4, 1fr); gap: 14px`. Each card:
   `--surface-card`, 1px `--border-control`, `--radius-card`, 14px padding, 12px gap:
   - Header row: role icon (22px), name (16px/600), then a state badge when not
     neutral — `MUTED` in `--loop` or `SOLO` in `--accent`, mono 11px, 1px border,
     `--radius-chip`.
   - A 34px mini-waveform canvas for that stem.
   - Gain: a 6px track (`--surface-track`) with a lime fill and a 20px round thumb
     (`--text-primary`, `--shadow-knob`), and the value in mono 13px, 34px wide,
     right-aligned. Range 0–1.5, step 0.01 (unchanged from the current app).
   - Mute / Solo: a 2-column grid of 46px buttons, icon + label. Engaged Mute is amber,
     engaged Solo is lime, both with the 3px ring.
   - A soloed card also gets a lime border and `box-shadow: 0 0 0 1px --accent-border`;
     a muted card dims its icon and name to `--text-tertiary` and its waveform to
     `--wave-muted`. **The card itself does not drop opacity** — the controls must stay
     fully legible while muted.
5. **Transport dock, 104px.** `--surface-raised`, 1px top `--border-subtle`. Three
   groups separated by 1px 60px-tall dividers:
   - **Left:** 62px circular lime play/pause (`--shadow-play`) with a mono 9px `SPACE`
     hint underneath; then the timecode — 26px/500 mono `0:41.20` over a 12px
     `/ 3:34.00`.
   - **Middle (flexes):** tempo. Legend row — `speed` icon, `TEMPO`, the value in
     20px/700 mono `--accent`, the words "pitch held", and a right-aligned ghost
     `RESET 1.00×`. Control row — a 38px `−` secondary button, the slider, a 38px `+`,
     and `0.50×` / `2.00×` end labels. The slider: 8px track, lime fill, a **26px
     rounded-square** thumb (7px radius — square, so it reads as a different instrument
     from the round gain thumbs), and a 1px detent tick at 1.00×.
   - **Right:** an 82×62px engaged-amber Loop button (icon over label, "Loop on");
     beside it a 2×28px row of `Set A [` / `Set B ]` secondary buttons and a ghost
     "Precision" toggle that opens drawer 2b.

Tempo is a 0.5×–2.0× multiplier, never BPM (see "Copy rules").

### 1c — Library, five states

Same header on all five: logo mark (28px lime rounded square with `graphic_eq` in
`--on-accent`) + "Gerson" (17px/700), the offline chip, and a right-aligned 44px
primary "Add a song".

**a. With songs.** Section legend `YOUR SONGS` + `3 · 1.4 GB on disk`. Song rows:
76px tall, `--surface-panel`, 1px `--border-subtle`, `--radius-card`, 8px gap between
rows. Contents: a 52px circular secondary play button that turns lime on row hover;
title (17px/600) over a mono meta line `3:34 · 4 stems · loop 17.8s saved · 0.85×`; a
180×34px waveform thumbnail at 60% opacity; then ghost Rename and Delete (40px, icon +
label). Delete's hover is the only red in the design: `--danger-wash` fill,
`--danger-border`, `--danger` text. Row hover also lifts the background one step and
tints the border lime.
Footer: `check_circle` + `NO SEPARATIONS RUNNING`, right-aligned mono
`Works offline · Export is the only backup`.

**b. Empty / first run.** Two columns, 24px gap. Left: a dashed drop zone
(2px dashed `--border-control`, `--radius-frame`, `--surface-well`) — 52px
`library_music` icon, "Drop a song to start" (26px/600), one sentence of body copy at
420px max-width, then a 52px primary "Choose a file" beside a 52px secondary
"Import stems", and a mono `MP3 · WAV · FLAC · M4A — up to 7 minutes`. Right, 340px:
two info panels — "Splitting takes a while" (the 9-minute cost, stated plainly) and an
amber-bordered "Install Gerson first" with a 44px amber action, because on iOS a
browser clears stored audio after a week idle and losing a library is worse than any
onboarding friction.

**c. Drop active.** The list dims to 25% and a full-cover overlay
(`--surface-app` at 82%) shows a dashed lime card: 46px `download_for_offline`,
"Drop to add this song", and mono `ONE FILE TO SPLIT · FOUR TO IMPORT AS STEMS`.

**d. Separating, with a queue.** A running-job panel with a lime border: a pulsing lime
dot, `SEPARATING` legend, the filename, a right-aligned 22px/700 lime percentage, a
10px progress bar, then `ABOUT 4 MIN LEFT`, the CPU-contention sentence, and a 40px
ghost Cancel. Below: legend `UP NEXT` + `2 waiting · one at a time, on purpose`, then
64px queue rows — position number in mono, filename, `4:18 · ~9 MIN`, two 40px reorder
arrows (the unavailable direction sits at `oklch(0.40 0.008 260)`, `cursor: default`)
and a ghost Cancel. Ready songs continue below. Footer turns active: lime dot,
`1 SEPARATION RUNNING · 2 QUEUED`, and the warning that a separation can't resume.

**e. Failed / interrupted.** Two alert cards, distinguished by colour *and* by the
action they offer:
- **Failed** — `--danger-border`, 26px `error` icon, badge `COULDN'T FINISH`, timestamp,
  the cause-specific advice sentence, then a **primary** Retry + ghost Dismiss.
- **Interrupted** — `--loop-border`, `pause_circle`, badge `STOPPED PART-WAY`, and a
  **secondary** "Start over" + ghost Cancel. Deliberately not primary: it costs the
  user nine minutes, so it should not be the brightest thing on screen.
- A third, quieter row for the length-cap refusal: `--surface-well`, `warning` icon,
  the rule sentence, ghost Dismiss only — this state has no retry that can succeed.

### 2a — Export sheet

A 560px right-hand sheet over a dimmed Player (`--surface-app` at 72%),
`--shadow-drawer`, 64px header (`download` icon, "Export", song title, 40px ghost close).
Body scrolls (`overflow-y: auto; min-height: 0`).

Two cards, and the difference between them is the whole point:

- **Stems** — neutral. `4 FILES · ZIP` legend, the sentence "One file per stem, exactly
  as separated. Gain, mute, solo, loop and tempo are ignored.", a FLAC/WAV segmented
  control (3px-padded track, lime active segment, 36px segments), a size estimate, and
  a **secondary** 52px "Export stems".
- **Mix** — what you hear. Lime-tinted border, `WHAT YOU HEAR` legend, then **chips
  showing exactly what will be baked in** (`VOCALS MUTED`, `BASS SOLO`, `LOOP 17.80s`)
  — this is the part the current UI leaves the user to guess. Same format control, then
  the apply-tempo toggle in its own inset block: a 52×30px switch, **off by default**,
  labelled "Render at 0.85× too" with the explanation that off renders at full speed and
  on goes through the stretcher. Then a **primary** 52px "Export mix".

Below, pinned: an amber-bordered note that export is the only backup.

Also specified: the in-progress state (lime percentage, 8px bar, "Playback keeps going —
this doesn't touch it.", ghost Cancel) and the WAV caveat note (WAV stems re-import
unlabelled; FLAC keeps the labels).

### 2b — Precision drawer

A bottom drawer over the Player, `--surface-raised`, 1px top `--border-raised`,
`--shadow-dock`. A 52px header (`tune`, `PRECISION`, right-aligned ghost "Hide"), then
four groups separated by 1px full-height dividers:

1. **Loop region, seconds.** Three fields — START, END (labels in `--loop`) and LENGTH.
   Each: a 48px `--surface-inset` well, 1px `--border-control`, mono 17px value, and a
   stacked 34×19px stepper pair. START and END each get a 38px secondary
   "From playhead"; LENGTH notes "moves End".
2. **Nudge the region.** Four 62×48px secondary buttons, icon over a mono step value:
   `⏪ 1.00`, `‹ 0.10`, `› 0.10`, `⏩ 1.00`. Below, a ghost "Clear the loop".
3. **Jump to.** A 48px seconds field + a 48px secondary "Go", and a ghost
   "Back to loop start".
4. **Playback.** The mono toggle — 48×28px switch, shown ON, "Mono", with the
   explanation that it halves memory use and helps on phones and older machines. Under
   it, the shortcut legend: `SPACE PLAY · [ ] SET A B · L LOOP · ← → NUDGE`.

### 2c — Modals

Centred cards, ~570px content width, `--surface-raised`, 1px `--border-raised`,
`--radius-frame`, 26px padding, `--shadow-modal`.

- **Model consent.** A 44px lime-washed rounded icon tile + the title
  "Download the separation model?", the 80 MB body copy, an inset row reading
  `THE ONLY TIME GERSON USES THE NETWORK`, then a flex-1 primary "Download" beside a
  ghost "Not now".
- **Downloading.** `downloading` icon, "Getting the model", a 46px/700 lime `51` with
  "MB of 80 MB" beside it, a 10px progress bar, one reassuring sentence, ghost Cancel.
  When total size is unknown, show received MB only and an indeterminate bar.
- **Import role mapping.** "Which stem is which?" + the untagged-set explanation. Four
  64px rows: filename over `4m 18s`, an amber `GUESS` badge on filename-prefilled rows,
  and a 44px select styled as a control (role icon + name + `expand_more`). The
  currently-open select gets a lime border and ring; an unassigned row gets an amber
  border and "Pick a role" placeholder. Then an amber validation note
  ("One role left to assign — each file needs a different one.") and a **disabled**
  Import (`--surface-track` face, `--text-disabled`, `cursor: not-allowed`) beside a
  ghost Cancel. Import enables only when all four roles are assigned and distinct.

### 2d — Mobile, 390×844

Playback only — separation needs a desktop, and the design says so rather than offering
a control that fails.

**Player:** 44px status bar (with the offline `cloud_off` glyph), 56px header, a 96px
waveform strip with the amber region and a `0:41 / 3:34` row, then legend
`TAP A STEM TO MUTE IT` and a 2×2 stem grid — each card 13px padding, icon + name, a
state word (`MUTED` / `ON` / `SOLO`) and a 5px gain bar. Whole card is the mute target;
no per-stem fader on mobile. Below: a tempo panel (19px/700 lime value + 6px slider)
beside a 96px engaged-amber Loop button. Bottom bar 104px: 56px skip-back, **76px** lime
play, 56px skip-forward.

**Library:** same header, an info panel ("Separating needs a computer. Your songs play
here."), song rows at 48px play button + title + mono meta, and a pinned amber
add-to-Home-Screen prompt.

---

## Interactions & behaviour

Behaviour that already exists keeps working exactly as it does now — this redesign does
not change playback, separation, storage or export logic. What the design adds:

| Trigger | Result |
|---|---|
| Header "Export" | Opens sheet 2a (slide in from right, 180ms ease-out). Playback is unaffected. |
| Dock "Precision" | Toggles drawer 2b (slide up, 180ms). Chevron flips. |
| Click/drag the loop lane | Sets/moves the region; drag an A/B handle to resize (`ew-resize`). |
| `Set A` / `Set B` | Writes the playhead into that bound. |
| Nudge buttons | Shift the whole region by 0.10s or 1.00s, preserving length. |
| Drag the waveform | Scrubs (`cursor: grab` → `grabbing`). |
| Follow | When on, the view keeps the playhead in frame; turning it off leaves the view where the user put it. |
| Stem card Mute / Solo | Fill + ring + state badge appear; a muted stem's waveform desaturates. |
| Row hover (library) | Background lifts one step, border tints lime, play button turns lime. |
| Drag file over window | Overlay 1c-c. |
| Format segmented control | Selecting WAV reveals the re-import caveat note. |
| Apply-tempo switch | Off → renders at 1×; on → renders through the stretcher (slower). |

**Keyboard** (new, and advertised in the UI — the hints must not lie):
`Space` play/pause · `[` set A · `]` set B · `L` toggle loop · `←`/`→` nudge region ·
`1`–`4` toggle mute on stems 1–4.

**Transitions.** 120ms ease for hover/colour changes; 180ms ease-out for sheet and
drawer entry. The running-separation dot pulses at 2s. Nothing else animates — a tool
you look at for an hour should be still.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, drop the slide-ins to
opacity fades and stop the pulse.

**Responsive.** Below ~1100px the stem grid goes 2×2. Below ~700px use the mobile
layout (2d): no separation controls, no per-stem faders, card-as-mute-target, 76px
transport.

**Focus.** Every interactive element needs a visible focus ring:
`outline: 2px solid var(--accent); outline-offset: 2px`. The current UI relies on
browser defaults; on these surfaces they are nearly invisible.

## State

No new domain state. The redesign needs only local UI state, all of it in the two route
components:

- `Player`: `exportSheetOpen: boolean`, `precisionOpen: boolean`, `zoom: number`,
  `follow: boolean` (already exists).
- `Library`: `isDragging: boolean` for the drop overlay.
- `ExportPanel`: `format: 'flac' | 'wav'` and `applyTempo: boolean` per card — these
  already exist inside the two export controls and should move into the sheet.
- Everything else — Practice state (gain / mute / solo / tempo / loop), job queue,
  catalogue — is read from the existing stores unchanged.

Two data points the design shows that you may need to surface (both derivable, neither
new domain state): total bytes on disk for the `1.4 GB on disk` meta, and a per-song
waveform thumbnail, which can reuse the existing peak data at a smaller width.

## Waveform rendering

Keep `app/src/waveform/draw.ts` and its `Int8Array` peaks. Changes:

- **Colours** move to the `--wave-*` tokens: `#9fadc0` full mix, `#95a2b4` stem,
  `#4e5765` muted, `#a8ef55` soloed and playhead (replacing `#6a8caf` / `#d9a441`).
- **Composition** changes from four stacked 64px canvases to one tall mix canvas
  (~316px) plus small per-card canvases (34px). The per-column min/max stroke loop is
  unchanged; only the target height differs.
- **Loop region** renders as `--loop-region-wash` over the waveform, with the area
  *outside* the region drawn at 32% alpha so the loop reads as the focus. The mock
  exposes this as a `loopShading` option — `both` (region tint + dimmed outside) is the
  intended default.
- **Playhead** is a 2px lime line with a small triangular cap at the top.
- Keep the `devicePixelRatio` scaling that's already there.
- The mock also offers `bars` / `filled` / `outline` peak styles; `bars` is the intended
  default. If you keep the existing solid min/max stroke, that reads as `filled` — also
  acceptable, and cheaper. Don't ship the outline variant.

## Copy rules

The repo's glossary in `CONTEXT.md` is authoritative and the redesign follows it: Song,
Separation, Stem, Recording, Practice state, Role. Tempo is always a multiplier
(`0.85×`), never BPM.

Copy that already exists in `app/src/separation/copy.ts` is used **verbatim** — the
CPU-contention notice, the interrupted notice, the cause advice, the model consent title
and body, the length-cap sentence. Do not paraphrase these in the components; keep
importing them from `copy.ts`.

New copy written for this redesign (friendlier tone, same terms) is quoted inline in
the screen specs above. The tone rule: state the cost plainly, never apologise, never
promise something local-first can't do. "Splitting takes a while — about 9 minutes for
a 7-minute song" is the register.

## Assets

- **Fonts:** Sora and JetBrains Mono (Google Fonts, weights above).
- **Icons:** Material Symbols Rounded, filled (Google Fonts). No SVG sprite needed.
- **Images:** none. Every waveform in the mocks is drawn to canvas from synthetic peak
  data; in the app it comes from real stems.
- The lime square logo mark is CSS + one icon glyph, not an image.

## Files in this bundle

| File | What it is |
|---|---|
| `README.md` | This document. Self-sufficient — implement from it. |
| `tokens.css` | Every design value as CSS custom properties, oklch + hex. Drop into `app/src/index.css` or import alongside it. |
| `designs/Gerson.dc.html` | The design reference. Turn 2 at top (2a export, 2b precision, 2c modals, 2d mobile), turn 1 below (1a Stage — **build this**, 1b Pedalboard — reference only, 1c Library states). |
| `designs/Gerson - Current UI.dc.html` | Faithful recreation of today's UI, for comparison. |
| `designs/support.js` | Authoring runtime for the two HTML files. Needed to view them; **not** part of the app. |

## Suggested build order

1. `tokens.css` + the two font links + the button/hit-target primitives. Nothing else
   works until the tiers exist.
2. Library with songs (1c-a) — exercises rows, buttons, header, footer.
3. Player Stage (1a) — the largest piece; waveform colour/composition changes land here.
4. Job states (1c-d, 1c-e) and the drop overlay (1c-c).
5. Export sheet (2a), replacing the two inline export controls.
6. Precision drawer (2b), moving the numeric loop inputs out of the main view.
7. Modals (2c) — restyle in place, logic unchanged.
8. Mobile (2d) and the keyboard shortcuts.

## Screens not designed

Deliberately out of scope, so don't infer them: the update banner, the eviction and
small-quota origin notices, and the settings surface (if one exists). They keep their
current markup; give them the new button tiers and type so they don't look orphaned,
and flag them back for a proper pass.
