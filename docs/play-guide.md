# Play campaign guide

The **Play** workspace is a guided film loop on one Cast character: Moodboard → Fitting → Day → Roleplay → **Cut film** → **Save to Cast**. This page is the product walkthrough; ops and env vars live in the [operator guide](operator.md) and [configuration](configuration.md).

Jump to: [When to use Play](#when-to-use-play) · [Step-by-step](#step-by-step) · [Dashboard metrics](#dashboard-metrics) · [Share & resume](#share-and-resume) · [Mobile vs desk](#mobile-vs-desk)

---

## When to use Play {#when-to-use-play}

| Workspace | Best for |
| --- | --- |
| **Simple** | First run — Generate, Gallery, Queue, Cast essentials |
| **Play** | One character, one look, one day-in-the-life film |
| **Studio / Full** | History, compare, templates, advanced queue controls |

Switch modes from the sidebar footer or **Profile → Appearance**. Play slimmed chrome hides draft-preview noise until you open it.

!!! tip "First film in under an hour"
    Heal & ready → random Generate still → **Play campaign** → Moodboard extract → Fitting Keep → Day stills → **Cut film** → Save to Cast. The Dashboard **Play film loop** card tracks time from campaign start to first cut.

---

## Step-by-step {#step-by-step}

### 1. Open Play (`/play`)

Pick or create a **Cast character**. The campaign stepper shows where you are: Cast → Moodboard → Fitting → Day → Roleplay.

### 2. Moodboard (`/moodboard`)

Stack up to four reference tiles (mood, lighting, location, style, palette). Optional gallery stills per tile.

- **Extract look** — builds a session look pack (vision merge when tiles have images).
- **Use in Fitting / Day / Roleplay** — hand off vibe notes + optional wardrobe lock.
- **Save on Cast** — named look packs on the character record.
- **Export JSON** / **Copy share link** — portable handoff (`#lookpack=` on `/play`).

Deep link: `/moodboard?character=<id>`.

### 3. Fitting Room (`/fitting`)

Lock a character plate, browse wardrobe kits, queue try-ons.

- **Keep / Skip** on completed try-ons — Keep stamps a gallery keeper and maps kits onto Day slots.
- **Continue in Day** — primary CTA after a keeper.
- **Save kit to Cast** — writes `lockedWardrobeId`.

Deep links: `/fitting?character=<id>&wardrobe=<kit>`.

### 4. Day Planner (`/day`)

Four slots (Morning → Night) with wardrobe, setting, and beat per slot.

- Queue stills per slot or **Queue all** (Play/Simple queues draft stills in parallel for a faster first film).
- **Animate slot / Animate all** — I2V from completed stills (stays Final quality).
- **Day reel** preview — clips preferred over stills; stills alone are enough to Cut.
- **Cut film** — server ffmpeg assemble when available, browser MediaRecorder fallback.
- After cut: **Watch / Save on Cast**, **Open in Gallery**, **Back to Play**. Roleplay is optional.

Deep links: `/day?character=<id>&wardrobe=<kit>` · Moodboard handoff: `?from=look`.

### 5. Roleplay (`/roleplay`)

**Optional** alternate ending: story beats, stills + clips, **Cut film**, Save to Cast. A Day cut already completes the campaign.

- **Play as** From bio or From photo (edit/img2img + identity lock).
- Fal **extend-video** when parent is on Fal CDN; else last-frame I2V.
- Tone and content rating controls (see [features — Roleplay](features.md#scene-tools)).

### 6. Close the loop

1. **Cut film** in Day or Roleplay records `firstFilmCut` metrics.
2. Dashboard **Save film to Cast** CTA opens Cast films tab.
3. **Watch film on Cast**, then **Cut another Day film** for the habit loop.

---

## Dashboard metrics {#dashboard-metrics}

The **Play film loop** card on `/dashboard` shows:

| Metric | Meaning |
| --- | --- |
| Campaign → first film | Days from first Play campaign to first Cut |
| Cut rate / Save-to-Cast rate | Local observability funnel |
| Funnel step chips | Deep-links to resume Moodboard, Fitting, Day, etc. |
| Stall banner | Where you are stuck before first cut + CTA to that step |

Empty state: **Open Play campaign** + **Heal & ready** link.

---

## Share and resume {#share-and-resume}

| Action | How |
| --- | --- |
| **Resume** | Campaign state + `lookPackId` restore on Cast; **Continue** on Play |
| **Share link** | Copy share link embeds pack in `/play#lookpack=…` (large packs → Export JSON) |
| **Cross-machine** | Studio backup JSON or look pack export/import |
| **Character mismatch** | **Switch to resume character** or restart at Moodboard |

Durable keys: `play-campaign-v1`, `comfy-play-metrics-v1`, look packs on Cast + session `moodboard-look-pack-v1`.

---

## Mobile vs desk {#mobile-vs-desk}

| Surface | Role |
| --- | --- |
| **`/m` (Mobile Studio)** | First-class film loop: Capture → Rate → **Moodboard → Fitting → Day → Play** |
| **`/m/moodboard` · `/m/fitting` · `/m/day` · `/m/play`** | Touch-first Board / Fit / Day / Play — stills + clips, Cut film, Save to Cast |
| **Desk** | Optional large-screen handoff (Campaign stepper, full Roleplay chrome) |

Phone is a first-class film loop. Desk Continue is optional when you prefer a large screen.

---

## Related docs

- [Operator guide — 10-minute loop](operator.md#10-minute-loop)
- [Features — Play & scene tools](features.md#scene-tools)
- [Troubleshooting — Play stall / metrics](troubleshooting.md#play-funnel)
- [Quick reference — routes & shortcuts](quick-reference.md)
