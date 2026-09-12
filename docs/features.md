# Features

Full capability list for Prompt Studio, grouped by area. For a short overview, see the [main README](../README.md).

Jump to: [Prompt generation](#prompt-generation) · [Scene tools](#scene-tools) · [Studio](#studio) · [Gallery](#gallery) · [Queue & ComfyUI](#queue-comfyui) · [Workflows](#workflows) · [Settings & data](#settings-storage) · [Auth & API](#auth-api) · [Automation](#automation) · [UI & UX](#ui-ux)

---

## Prompt generation & models {#prompt-generation}

- Searchable model picker with architecture-family filters
- Profile-based prompt styles shared across related checkpoints
- Prompt detail levels (Concise / Balanced / Rich) with **combined model × detail size limits**
- Minimum character enforcement for long-form models (Image-2.0 Rich, FLUX Rich, etc.)
- Positive and negative/preserve prompt modes
- Uncensored system prompts (no content filtering or refusals)
- One-click copy for ComfyUI paste
- LLM-powered generation/formatting with rules fallback
- **Prompt diagnostics** — lint sport/duo/helmet conflicts before or after generation
- **Compact & cross-model reformat** — trim to model limits or reformat for the alternate model from any result panel
- **Pre-lint + rule fix** — Duo shows hint lint before generate; **Fix prompt (rules)** applies helmets, sport strips, etc.
- **Qwen Edit builder** — segment-based edit instruction builder on Generate for Qwen Edit models
- **Generate sport presets** — sport preset chips on Generate (positive mode) with shareable scene URLs
- **Model recommender** — Generate sidebar suggests models from prompt text (`/api/models/recommend`; UI uses server route with client fallback)
- **Token / weight inspector** — `(tag:1.2)` analysis on Lint, Format, and result panels
- **Prompt readiness score** — pre-queue lint badge on result panels (`/api/readiness`)
- **Readiness-gated queue** — result panels warn below score 60; confirm or fix before ComfyUI queue
- **Readiness auto-fix** — one-click compact / rule-fix / reformat from readiness panel
- **Negative prompt learner** — learns tokens from low gallery ratings; Settings → Advanced
- **Avoidance preview** — Settings shows matched tokens and LLM instruction before generation
- **Avoided tokens** — low gallery ratings record motifs to avoid; all generators honor avoidance via LLM instruction and template pool filtering
- **Avoided tokens settings** — view, add, remove, and clear the local avoidance list in Settings
- **Avoided tokens import/export** — JSON list management on Settings
- **Context-aware negatives** — ComfyUI queue picks negative profiles from tool/hints (pet, fantasy, sport, etc.)
- **Auto-negative on queue** — optional Settings toggle + negative profile library for SD-family ComfyUI queue
- **Lint playground** — `/lint` for paste-and-fix without generating a new scene

## Scene tools & catalogs {#scene-tools}

- **Mobile Studio** — `/m` (Add to Home Screen via `manifest-mobile.json`): **phone-first film loop** — Capture → Queue → Rate → **Moodboard → Fitting → Day → Play**. Touch shells on `/m/moodboard`, `/m/fitting`, `/m/day`, and `/m/play` reuse desk orchestration (swipe kits, four Day slots, Roleplay stills **and** clips via I2V/T2V/continue). **Cut film** / **Save to Cast** are primary on phone (shared assembler, server ffmpeg preferred). Header **Desk** bridge is an optional large-screen handoff (Campaign / Board / Day / Fitting).
- **Play workspace** (first-run default) — sidebar footer / Profile → Appearance: Cast, Fitting Room, Day Planner, Roleplay, Gallery, and Queue. Roleplay routes use a lean rail. Moodboard lives under Scene nav and ⌘K. Simple remains available for a lean essentials layout.
- **Simple Essentials** — Dashboard, Generate, Cast, Roleplay, Gallery, and Queue; Studio, Video, Refine, Compose, Inpaint, Fitting, Day, Moodboard, and the rest sit under More tools (⌘K finds everything).
- **Gallery collections** — bulk **Collect** (favorite/rate), **Group** (named batches), and **Project** (campaign scope); tags are under Project in full mode only.
- **Lean gallery** — Simple and Roleplay workspace modes use slimmer filters and bulk actions on `/gallery`.
- **Fitting Room** — `/fitting` (Play workspace / Scene nav): lock a Cast character plate, **filter wardrobe kits by clothing type** (outfits, tops, outerwear, etc.), **swipe catalog wardrobe kits** (Prev / Next / chip strip with **lazy draft 512px try-on thumbs**, or full catalog select). **Auto draft previews** / **Preview kits** queues Boogu Edit Turbo (when available) at draft quality; full **Queue try-on** stays high quality. **Keep / Skip** on completed try-ons — Keep stamps a gallery keeper on the active look, maps keeper kits onto Day morning→night slots, and surfaces a primary **Continue in Day** CTA; **Compare try-ons** shows the last four results side by side. Deep links `?character=` and `?wardrobe=`; **Save kit to Cast** writes `lockedWardrobeId`; **Continue in Roleplay** carries the active character. Cross-links to Day Planner (passes wardrobe) and Moodboard. Moodboard look packs apply via `?from=look`.
- **Day Planner** — `/day` (Play bottom bar / Scene nav): pick a Cast character and plan four time slots (Morning → Night) with wardrobe kit, setting, and beat per slot; **filter outfit kits by clothing type** per session. Queue one still or all slots. **Animate slot / Animate all** queues I2V clips from completed stills. Completed stills and clips sync into a **Day reel** (clips preferred); **Cut film** prefers server **ffmpeg** H.264/AAC MP4 via `/api/film/assemble` (720p/1080p, optional crossfade/audio bed) and falls back to browser MediaRecorder; auto-stamps when Cast is set, and surfaces **Open on Cast** (`?media=films`) / **Open in Gallery** (`derivedKind=film`) / **Campaign complete — Open Play**. Deep links `?character=` and `?wardrobe=` (seeds empty slot kits); Moodboard look packs via `?from=look`. Cross-links to Fitting Room, Moodboard, and Roleplay (`?from=look` when a pack is staged).
- **Moodboard → Scene** — `/moodboard` (Play nav / Scene / ⌘K): stack up to four reference tiles (mood, lighting, location, style, palette) with optional gallery stills; choose a merge template and queue one scene still. **Extract look** builds a session look pack (vision merge when tiles have images, otherwise text cues) and **Use in Fitting / Day / Roleplay** hand off vibe notes + optional wardrobe lock. **Save on Cast** persists named look packs on the character record; **Export JSON** downloads a portable look pack for another machine. Deep link `?character=`; cross-links to Day Planner, Fitting Room, Roleplay, and **Play campaign** (`/play`).
- **Play campaign** — `/play` (Play workspace): guided stepper — Cast → Moodboard → Fitting → Day → Roleplay — with look pack + character state carried through session handoff and saved look packs on Cast. **Export / Import JSON** for look packs; **Copy share link** embeds the full pack in `/play#lookpack=…` (falls back to Export JSON when the hash exceeds URL limits). Durable **resume** restores step + saved `lookPackId` on Cast; `/play?character=&lookPack=` deep links after saving on Cast. Cutting a film in Day or Roleplay marks the campaign complete and surfaces a finished state (Open film on Cast / Start new campaign).
- **Roleplay** — `/roleplay` (Play workspace, or More tools in Simple): pick an archetype or custom persona, optionally assign a character name, write a bio, roll four story beats that **continue from the last pick** (unpicked cards stay off later rolls), tap a beat to queue a still or a clip in the story reel. Accepts Moodboard look packs via `?from=look&character=` (seeds **Setting**, **extra hints**, inferred **Tone**, and wardrobe lock). A still becomes I2V; a text-only beat is T2V; later beats continue from the last clip — **Extend clip** (Fal LTX extend-video, Grok `/v1/videos/extensions`, or Runway `/v1/video_to_video`), **Continue from last frame** (Replicate last-frame I2V; Fal soft-fails CDN upload → last-frame), or **Stitch continue** (Gemini last-frame I2V then server `/api/film/assemble` concat for the watch playlist). Roleplay/Video surface which path ran. **Cut film** prefers server ffmpeg via `/api/film/assemble` and falls back to browser MediaRecorder; **Save to Cast** reuses that assembled blob (no second encode) when the cut succeeded. After cut: **Open on Cast** / **Open in Gallery** deep-links and a **Campaign complete** CTA back to `/play`. **Play as** From bio (default, text-to-image models) or From photo (upload a selfie, pick a gallery still, or reuse the last story still — the model picker switches to edit / img2img checkpoints and each beat queues img2img + optional local identity lock from that reference). **Isolate on white** (default) cuts the subject onto a blank plate so the photo’s scene does not leak through; prompts aim to keep face/hair/body identity and **replace the photo’s clothes** with the beat’s outfit (model-dependent, not a hard guarantee). Optional **Setting** seeds a location into bios, beats, and stills. Exclusive **Tone** (Silly, Cinematic, Cozy, Chaotic, Noir, Romantic, Horror, Deadpan, Epic, Dreamy, Gritty, Melancholy) and **Content** rating (SFW: Clean, PG-13, Suggestive; Adult: Sultry, Explicit, Raunchy — uncensored; Explicit names sex and anatomy — hidden unless `PROMPT_NSFW_GENERATOR_ENABLED` and `NEXT_PUBLIC_PROMPT_NSFW_GENERATOR_ENABLED` are true) plus an additive **Gore** toggle. Stills and clips render inline; download a zip of `story.md` + stills. **Library** auto-saves the open session in the browser (capped); **Save & start new** (or a new cast) shelves it so you can continue or delete later. Write a bio with the LLM, or **create / paste your own character bible**. Consenting adults only; no minors. Default PG-13.
- **Cast** — `/characters`: character homes for looks, stills, clips, assembled **Films**, and the Roleplay film cut. Continue reel uses Video I2V; **Continue in Roleplay** works for Play/Fitting Cast records (synthesizes a library session from Cast bio/descriptor when the Roleplay library entry is gone). Roster empty CTA points at **Create on Play**. **Try on** opens Fitting Room; **Plan a day** opens Day Planner; **Set look** opens Moodboard. **LoRA flywheel** — Export → Train writes keepers under `PROMPT_DATA_DIR` and starts `/api/lora-train` with `datasetPath`; Register & pin installs into Comfy `models/loras`; **Prove it** (or auto on register) queues a validation still.
- **Compose** — `/compose`: multi-image transfer / modify with identity lock, regional edit, and gallery re-edit. **Isolate on white** (default) cuts Image 1 onto a blank plate so the original scene does not leak; Images 2–4 stay intact as pose/scene donors. Continue-edit gallery handoffs skip isolation so the full canvas remains. **Transfer scan** vision-reads every filled slot and writes a transfer instruction (recipes: pose↔people, people→pose+scene, outfit, background, style/light, hair, expression). **Z-Image** sends Figure 1 to the sampler; extras stay in the prompt. Cloud img2img is Image 1 only unless the model is a documented multi-ref edit (Fal Kontext multi / FLUX.2 edit / nano-banana edit, or Replicate multi-image Kontext). Transfer stays blocked on single-ref cloud. **Identity lock:** local Comfy uses IP-Adapter / InstantID / PuLID; Diffusers stills compile SDXL `IPAdapterAdvanced` natively (FaceID/PuLID drop-ins fall back to hub Plus weights; InstantID compiles natively on SDXL for txt2img/img2img/inpaint; PuLID stays Comfy); cloud uses face-ref (session face + Image 1 as ordered multi-refs when the endpoint allows, otherwise a weighted identity prompt — never Comfy IP-Adapter on cloud).
- **Character generator** — solo, duo/sport, and compose-with-background modes; sport presets, team kit, batch roll, ComfyUI queue
- **Scene compose mode** — Character tool merges background + subject into one scene prompt
- **Regional prompt composer** — Character tool merges labeled subject/background/lighting segments; queue-time `workflow-regional-patch` also wires AttentionCouple-style nodes when installed
- **Location blocklist** — block locations in Studio catalog; all generators respect the list
- **Locked wardrobe** — pin a catalog outfit from Studio; Character and batch tools reuse it
- **Locked location & variation seed** — pin scene place and environment seed for reproducible rolls
- **Scene starter catalog** — ~294 searchable presets on Generate/Character (category, framing, tag filters; `/` focuses search)
- **User scene starter presets** — save current hints or promote gallery analytics tokens; export/import starter packs in Studio Presets
- **Hint source** — Manual, From history, or Random on Generate, Character, Pet, Fantasy, Background, Topics, and Variations
- **Persisted preset filters** — search, framing, and tag filters survive reload via settings cache
- **Use as hints** — Studio history rows open the source tool with hints prefilled (`hintSource=manual`)
- **Queue from preset** — selected scene preset → **Queue 4 variations** handoff to `/variations?from=preset`
- **Active character descriptor** — shared mandatory character sheet injected into Character API requests
- **Wardrobe avoided tokens** — low-rated motifs filter catalog wardrobe picks across generators
- **Catalog rating bias** — Studio catalog sorts clothing/locations by gallery review scores; click **Insert** to add to hints
- **Rating-driven random** — history/gallery favorites and downvotes subtly adjust random-scene wildness
- **Adult generator plugin** — env-gated `/plugins/nsfw-generator` with 120+ built-in presets, search/favorites/recent, user-saved presets, and Rapid AIO / Z-Image / Qwen quality recipes. A one-time in-browser acknowledgment (18+, legal where you are, consenting adults only) gates the tool itself, separate from the env flags that gate the deploy.
- **LoRA stack inline tuning** — per-run model/clip strength overrides in the sidebar (session-only; included in session recipes and compare recipes)

## Studio {#studio}

- **Studio** — prompt history with ratings, model compare, catalog browser, templates
- **Studio presets & diff** — named scene lock bundles, history search/filters/tags, word-level prompt diff, custom templates, shareable `?scene=` preset URLs
- **Studio analytics** — per-user history + gallery activity summary and gallery rating token stats (high vs low motifs)
- **Studio analytics actions** — add negative-scoring tokens to avoidance from the Analytics tab
- **Analytics live refresh** — Studio analytics updates when gallery ratings change
- **Studio deep links** — `/studio?history=<id>` highlights a saved prompt; gallery links back to history
- **Prompt projects** — named campaigns filter Studio history; new saves attach active project id
- **Prompt iteration tree** — Studio tab shows parent/child history branches via `parentHistoryId`
- **Iteration tree actions** — Regenerate, Refine, and re-queue from iteration tree nodes
- **Iteration tree export** — download parent/child history branches as structured JSON
- **Iteration branch diff** — compare parent/child prompts on Studio iteration tab
- **Auto lineage** — Improve/Refine/Reformat saves attach `parentHistoryId` for Studio iteration tree
- **Refine diff panel** — word-level diff when refining from a saved history parent
- **Cherry-pick merge** — Studio Diff tab merges two prompts with lint checks
- **Experiment dashboard** — Studio Experiments tab groups gallery outputs by prompt/seed variants
- **Experiment list virtualization** — window virtualizer for large experiment group lists (48+ groups)
- **Shared-project collab** — presence bar + field-level draft sync (`hints`, `instruction`, `positive`, etc.) via BroadcastChannel and `/api/collab` SSE; room state persists to SQLite and optional `COLLAB_REDIS_URL` for multi-node; Settings → Overview shows collab backend health; **Apply draft** merges remote edits on Generate, Character, Refine, and Compose
- **Experiment winner workflow** — crown winners, compare export, re-queue groups on Studio Experiments tab
- **Style transplant** — Studio → Experiments applies lighting/camera mood from one prompt to another
- **Duplicate detection** — Studio → Experiments finds near-identical history clusters
- **Multi-model portfolio** — Studio Portfolio tab formats one draft for several models and batch-queues
- **Portfolio diff export** — cross-model Markdown/HTML diff from Studio Portfolio tab
- **Portfolio CLI queue** — `npm run prompt:cli -- portfolio --input "..." --queue` formats and queues each model to ComfyUI
- **Visual model compare** — Studio Compare tab can queue both models to ComfyUI and show outputs side-by-side
- **Character identity bundles** — export/import reusable character sheets from Studio Presets
- **Character identity bundles with saved list** — browser-local list (descriptor, LoRA triggers, IP-Adapter ref) alongside JSON export/import
- **Preset packs** — import/export bundles of scene presets from Studio Presets tab
- **Prompt brief** — export/import portable prompt bundles from Studio Presets
- **Campaign templates** — save/load campaign recipes on Studio Campaign tab
- **Studio campaign runner** — batch random scenes or topics with optional ComfyUI queue
- **Project bundles** — export/import project history + gallery JSON from Studio Projects tab
- **History/gallery export** — CSV and JSONL export from Studio and Gallery bulk actions
- **History batch re-queue** — re-queue saved `batchPrompts` from batch ComfyUI sends
- **History bulk actions** — tag or delete all entries matching the current Studio history filters
- **Semantic search** — token-overlap ranking in Studio history and Gallery filters
- **Embedding search** — semantic history filter uses Ollama embeddings when available (`/api/search/embeddings`)
- **Global search** — command palette (`Ctrl+K` / `Ctrl+Shift+K`) searches history, gallery, and scene presets

## Gallery {#gallery}

- **Gallery** — `/gallery` stores queued jobs in IndexedDB (Dexie) and displays output images, clips, audio, and 3D meshes when ComfyUI finishes; previews appear inline on result panels
- **In-place clip playback** — WAN/LTX animated WebP and mp4/webm play on gallery cards, lightbox, Roleplay beats, Video results, Queue, and Cast instead of a flattened still; view proxies skip Sharp flattening for motion bytes
- **Audio and 3D gallery media** — Stable Audio wav/flac/mp3 and Hunyuan3D glb/gltf/obj are captured from Comfy history, persisted as originals, playable (audio) or downloadable (3D) from cards/lightbox, and included in ZIP export. Filter chips: Audio / 3D.
- **Import completed host jobs** — Gallery import prefers Comfy `GET /api/jobs` and falls back to `/history`; walks every pool host; imported rows keep the workflow graph when present
- **Failed-job node install** — missing `class_type` errors offer Install missing nodes (Manager + restart + retry) on Queue, Gallery, and workflow preview
- **Gallery stats bar** — at-a-glance totals (completed, in queue, favorites, unreviewed, avg rating) with one-click filter chips
- **Gallery layout modes** — Grid, Dense, or List view (persisted)
- **Gallery review focus** — review mode auto-selects the first card; keyboard 1–5 / F / N / P
- **Gallery review mode** — rate completed outputs 1–5; low ratings feed wildness/avoidance bias
- **Gallery review shortcuts** — 1–5 rate, F favorite, N/P navigate in review mode
- **Gallery review auto-advance** — optional jump to next unreviewed item after rating
- **Mobile gallery review** — touch-friendly rating bar in gallery review mode
- **Gallery compare modal** — compare 2–4 selected outputs in a full-screen overlay (`GalleryCompareModal` + `useGalleryCompareHandlers`)
- **Exact graph replay** — queue stores capped `workflowJson` on gallery entries; cards show an Exact graph badge and **Replay exact graph** (falls back to Comfy history when omitted)
- **Lineage filters** — Upscale / Refine / Soft pass / Variation / Moiré / Face detail / ControlNet derivative chips
- **Gallery compare panel** — pick winner, rate, favorite, mutate, or improve; bulk **Seed experiment**
- **Gallery compare** — select 2–4 completed entries for side-by-side review on `/gallery`
- **Gallery card polish** — hover quick actions (Open, Improve); storage cap warning near 5,000 IndexedDB entries
- **Gallery tools** — favorites, status/tool/media filters, image/audio/3D download, sidecar JSON export per entry
- **Gallery custom groups** — select cards → Group menu to assign a name; Groups rail to browse; Rename / Delete group clears the label across items. Filter by Group (or Ungrouped); click a card badge to show that set.
- **Gallery project filter** — filter `/gallery` by the active Studio project
- **Gallery project filter & assign** — filter by project dropdown; bulk assign entries to projects
- **Gallery ZIP export** — bulk export selected entries as originals (images, clips, audio, meshes) + sidecars
- **Gallery → Refine / Image→Prompt** — open completed outputs with image + prompt pre-loaded
- **Gallery handoffs** — send selected prompts to Topics batch or Variations matrix (`?matrix=1`)
- **Gallery param grid** — CFG × steps experiment grid from a selected entry
- **Gallery A/B export** — export compare selections as JSON or HTML side-by-side reports
- **Gallery embedding search** — semantic and find-similar use `/api/search/embeddings` when available
- **Find similar outputs** — rank gallery entries by prompt similarity to a selection
- **Mutate winner** — re-queue gallery entries with location/wardrobe/wildness/variation mutations
- **Compare winner lineage** — pick winner sets lineage parent when the entry has history
- **Compare pick-winner auto-improve** — high-rated winner triggers auto-improve loop
- **Param experiment queue** — sweep CFG, steps, width, or seed from a selected gallery output
- **Vision gallery review** — AI-suggested rating, tags, and critique in review mode
- **Gallery vision tags** — auto-tag completed outputs; filter by “Vision tags”
- **Fullscreen slideshow** — gallery filter bar starts immersive slideshow with keyboard controls
- **Improve output pipeline** — one-click Improve from gallery or result panels opens Refine with image + intent
- **Low-rating refine loop** — 1–2★ gallery ratings open Refine with corrective intent automatically
- **ELO tournament** — bracket compare mode in gallery compare
- **Aesthetic scoring** — heuristic gallery score on cards; `POST /api/aesthetic/score` for snapshots
- **Gallery PWA** — optional service worker caches `/api/comfyui/view` image responses for faster revisits
- **PWA manifest** — installable web app metadata (`manifest.json`)

## Queue & ComfyUI {#queue-comfyui}

- **Workflow takeover** — at queue time auto-bind placeholders, patch latents/loaders/samplers, insert FLUX sampling nodes, and upscale outputs; see [Workflow takeover](workflow-takeover.md)
- **Queue quality profiles** — sidebar Draft / Final / Max; per-tool overrides in Settings; gallery stores and re-queues with stored profile
- **ComfyUI job status** — polls ComfyUI history after queue; pending/running/completed in the UI
- **ComfyUI WebSocket progress** — optional faster job updates in Settings
- **Re-queue** — gallery entries and Studio history can be sent to ComfyUI again (same params, new seed, upscale, or new variation at Final/Max)
- **Variation grid** — `/variations` rolls N prompt variations and batch-queues them with unique ComfyUI seeds
- **Prompt matrix mode** — `/variations?matrix=1` for row×column variation grids
- **Matrix CSV export** — Variations matrix mode exports row×column grid to CSV
- **Batch ComfyUI queue** — queue all duo batch rolls to ComfyUI with shared negative
- **Topics batch build** — turn a topic list into full Generate or Character prompts via `/api/topics/batch`
- **Topics → Variations handoff** — send a topics batch to `/variations` as an imported grid
- **Batch lint gate** — Topics and Variations bulk queue lint prompts first (fix-all or skip errors)
- **Batch history auto-save** — batch ComfyUI queue saves one lineage history entry when auto-save is enabled
- **Export pipeline** — “Prepare for ComfyUI” runs lint → fix → compact → copy pair → optional queue from any result panel
- **Preview workflow** — dry-run before queue on Generate, Character, Format, Lint, Refine, and other result panels
- **Workflow dry-run** — preview injected workflow JSON in Settings (and from Lint result panels) before queueing
- **Custom workflow tokens** — user-defined placeholders like `{{CHECKPOINT}}` and `{{LORA}}` with values in Settings
- **ComfyUI workflow** — optional `COMFYUI_WORKFLOW_PATH` or Settings → ComfyUI queue settings (stored in browser)
- **Smart workflow defaults** — Settings maps workflow filenames to model categories automatically
- **Workflow pre-flight** — Topics/Variations batch queue validates workflow placeholders before submit
- **ComfyUI param recovery** — gallery re-queue restores saved seed/params from `queueParams`
- **LoRA trigger injection** — missing trigger phrases from the LoRA library append on ComfyUI queue
- **LoRA train pipeline** — Settings → ComfyUI → LoRA train + Cast flywheel: export keepers to `{PROMPT_DATA_DIR}/lora-datasets`, durable SQLite jobs, first-party kohya/sd-scripts templates (rank/steps/resolution), optional `TRAINER_URL`/`TRAINER_COMMAND` escape hatch, copy weights into `COMFYUI_ROOT/models/loras` on complete, pin + Prove validation
- **Queue param overrides** — optional seed/width/height/cfg/steps overrides in Settings and result panels
- **Queue orchestration panel** — home/gallery view of ComfyUI server queue, VRAM, and local tracked jobs
- **Central job queue** — `/queue` page for pending ComfyUI jobs
- **Queue upgrades** — `/queue` shows ComfyUI queue stats (pool totals + per-host depth), failed jobs, and bulk retry
- **Orphan host jobs** — Queue lists in-flight Comfy jobs from every pool host that are not in this gallery; Import or Import all to track them
- **VRAM-aware Max → Final** — when free VRAM is under ~6 GB, Max queues downgrade to Final
- **Hold Max until idle** — optional park for Max jobs until ComfyUI is empty; flush from Orchestration
- **Sampler memory** — 4–5★ gallery ratings remember per-model CFG/steps/sampler/scheduler
- **Multi-ComfyUI pool** — `COMFYUI_POOL` plus Settings extras; load-balance skips busy hosts; OOM / dead-host retry fails over; optional sticky preferred host for gallery stills
- **Second-GPU snippet** — after Test (or allowlist miss), copy `COMFYUI_POOL` / `COMFYUI_ALLOWED_HOSTS` into `.env.local`; probe never fetches an unallowlisted host
- **Queue artifacts** — optional `COMFYUI_QUEUE_EXPORT_DIR` or Settings overlay writes JSON sidecars after queue
- **ComfyUI job status node** — `PromptToolsJobStatus` polls `/api/comfyui/status`
- **ComfyUI Topics Batch node** — `PromptToolsTopicsBatch` calls `/api/topics/batch`
- **ComfyUI avoided tokens** — optional `avoided_tokens` input on generator nodes passes motif avoidance to the API
- **Negative A/B** — same-seed ComfyUI queue with/without negative for SD-family models
- **Same-seed shootout** — queue one prompt across models with identical seed (Settings → Advanced)
- **Auto-improve loop** — optional auto-mutate or seed-experiment on high ratings / favorites
- **Prompt recipes** — Settings → Advanced chains lint/fix/compact/queue steps
- **Prompt lineage** — gallery entries link to Studio history when queued from result panels

## Workflows & library {#workflows}

- **Workflow preset packs** — import/export bundled presets in Settings workflow library
- **Workflow preset pack builder** — add workflows or settings snapshots to packs; install packs into library
- **Workflow diff** — Settings compares two workflow JSON files
- **Workflow node auto-map** — suggested positive/negative bindings while editing workflow JSON
- **Video prompt builder** — `/video` + local WAN / Hunyuan / LTX, or Fal / Replicate / Grok / Gemini / Runway clips (T2V, I2V, extend). I2V **Scan with vision** fills Subject and Motion from the first frame. Extend chip: **Extend clip** (Fal LTX / Grok extensions / Runway Aleph video-to-video), **Continue from last frame** (Replicate; Fal upload soft-fail), or **Stitch continue** (Gemini + `/api/film/assemble`). ChatGPT warns before queue. Compact **Video model files** Install rows download WAN / Hunyuan Video / LTX weights into `COMFYUI_ROOT`.
- **Logo / Audio / Mesh (parked Extras)** — `/logo`, `/audio`, and `/mesh` remain available under the sidebar **Extras** group (and ⌘K) but are soft-deprecated specialty tools. Prefer Play + Video for motion; Character page covers pet/fantasy/environment without the legacy `/pet` `/fantasy` `/background` routes (those stay palette aliases).
- **Audio / mesh model files** — Settings → ComfyUI → Model assets can still Install Stable Audio Open 1.0 + T5-Base, and Hunyuan3D 2.0 DiT into `checkpoints/` / `text_encoders/` when using the parked tools.
- **Refine vision scan** — `/refine` **Scan with vision** fills Current prompt from the reference still (same pattern as Video I2V), then intent + Refine.
- **Vision scan on still tools** — Inpaint, Outpaint, Compose (Image 1), ControlNet, and Roleplay From photo share **Scan with vision** next to Choose from Gallery. Compose also has **Scan all images → instruction** for multi-slot transfer recipes.
- **Tool-locked model pickers** — Video stays on WAN / Hunyuan / LTX; Inpaint / Outpaint / Compose / Refine / From photo stay on edit/img2img. Show all is hidden on video/audio/mesh.
- **Workspace first paint** — saved Simple / Play / Studio / Full is read from a cookie so chrome matches on load instead of flashing Simple.
- **Mobile Cut film** — `/m/play` and `/m/day` Cut film and Save to Cast with the same assembler as desktop (Cast / Gallery deep-links and Campaign complete CTA). Phone is first-class; Desk Continue is optional.
- **ControlNet prompt builder** — `/controlnet` tool for depth/pose/canny/normal/lineart conditioning text
- **ControlNet from image** — upload reference for vision-assisted structure extraction on `/controlnet`
- **ControlNet gallery lineage** — gallery → ControlNet handoffs keep parent entry + source image; derivatives filter as ControlNet
- **Multi-ref image prompts** — Image tool accepts up to 4 references (`/api/image-prompt/multi`)
- **IP-Adapter multi-ref merge** — vision LLM describes refs and blends into text prompt (no ComfyUI IP-Adapter nodes)
- **Portable IP-Adapter identity** — Settings → ComfyUI patches `{{IPADAPTER_*}}` tokens or auto-inserts IPAdapter chain at queue time

## Settings, storage & backup {#settings-storage}

- **App database (Dexie)** — settings, history, presets, workflows, webhooks, and gallery in IndexedDB (`comfy-prompt-studio-v1`); legacy `localStorage` migrates on first load
- **Settings cache** — target model, detail level, and per-tool options persist across reloads and pages
- **Settings hub** — `/settings` tabs: Overview (Heal & ready, health, backup), LLM, ComfyUI (cluster + assets), Automation, Data, Users (SMTP + invite)
- **Settings env panel** — copy `.env` snippet and re-run LLM/ComfyUI health tests from Overview
- **Heal & ready** — one-click first install: system workflows, loader maps, inventory adapt, ComfyUI-Manager pack install on each pool host, restart, health refresh
- **Studio backup v5** — export/import history, settings, gallery, workflows, projects, recipes, **and extras** (gallery ELO, views, appearance, shortcuts). v1–v4 still import
- **Overview one-click backup** — Export / Import on Settings → Overview for a new browser or machine
- **Full user backup** — Profile downloads/restores the same studio backup JSON
- **Backup reminder** — Overview/Data warn when no recent export
- **Prompt sidecar** — download JSON sidecar (prompt, model, diagnostics, seed) from result panels or Studio history
- **Sidecar import** — load sidecar JSON on Gallery, Lint, and Variations to restore prompts or re-queue
- **Server storage sync** — optional `PROMPT_DATA_DIR` SQLite (`studio.sqlite`) via `/api/storage`; per-user scopes when logged in
- **Server storage pull** — Settings advanced panel restores server namespaces into the app database
- **Auto storage sync** — pull on login when browser is empty; conflict merge UI when local/server diverge
- **Auto-push storage** — history and gallery saves debounce-push to server when storage sync is enabled
- **Multi-tab sync** — BroadcastChannel refreshes gallery/history across open tabs
- **Encrypted exports** — `POST /api/storage/export` with optional passphrase
- **Encrypted server export** — Settings → Advanced exports signed-in user data with optional passphrase
- **Auto-save on queue** — Settings toggle; skips duplicate history when you already saved manually

## Auth, admin & API {#auth-api}

- **User accounts & feature ACL** — optional login, groups, blocked features, **viewer** role, per-user ComfyUI URL override, API quotas (Settings → Users)
- **Invite by email** — admin creates a user (or re-sends) via SMTP; 1-hour `/login?reset=` link. Password optional on invite
- **SMTP overlay** — Settings → Users persists host/port/from in SQLite when `PROMPT_DATA_DIR` is set; **Send test** uses the overlay immediately
- **Password reset** — `/login` forgot-password + `POST /api/auth/reset-password`; same mailer as invites
- **Profile** — password change, export toggle, scheduled campaign settings, 2FA, sessions, email, appearance
- **Admin tools** — audit log, user impersonation, shared read-only preset library, analytics trends over time
- **Per-user API keys** — `pt_…` tokens for CLI/inbound hooks with user quotas
- **Inbound webhooks** — `POST /api/hooks/generate` with user API key or `INBOUND_WEBHOOK_SECRET`
- **TOTP 2FA** — optional authenticator setup on Profile
- **Session management** — list/revoke sessions on Profile
- **API usage & rate limits** — proxy logs usage; optional `PROMPT_API_TOKEN` + rate limit env vars
- **LLM usage dashboard** — per-user call/token stats in Settings → Advanced
- **Observability dashboard** — Settings advanced panel shows API volume, errors, and slow routes
- **Shared projects** — admin assigns group-scoped projects via `/api/shared-projects`
- **Shared projects UI** — admin CRUD in Settings → Users; adopt in Studio → Projects
- **Plugin registry** — `/plugins` **Sidebar bookmarks**: custom localStorage **nav bookmarks** (href-only; not a runnable plugin runtime; cap 32)
- **Plugin iframe host** — `/plugins` **Runtime plugins**: installable manifests embed tools at `/plugins/[id]` with queue / apply-prompt / apply-model / apply-quality / apply-engine / apply-lora-stack / patch-workflow-tokens / write-gallery-tag / pick-gallery (`docs/plugin-iframe-host.md`). Choose runtime when you need iframe or queue hooks; choose bookmarks for simple deep links.
- **Server plugin registry** — `{PROMPT_DATA_DIR}/plugins` via `/api/plugins/server` (ZIP/URL install, optional `PROMPT_PLUGIN_HMAC_SECRET`); privileged `queue-preflight` / `queue-post` hooks inside the Comfy queue path with allowlisted prompt/workflow rewrite; sync into the UI runtime list. Auth on → `plugins` feature + admin for install/remove.
- **Queue failure playbooks** — missing-node and loader failures deep-link toast CTAs to Settings sections
- **Simple first-success** — first completed render in Simple mode advances onboarding and nudges Gallery review; checklist offers **Open Play workspace** from first-queue-success onward (earlier than campaign-only), and Simple Essentials includes `/play`
- **CLI** — `npm run prompt:cli -- duo --hints "..."` over the HTTP API

## Automation & integrations {#automation}

- **Automation hub** (Settings → Automation) — webhooks, avoided tokens, browser/server scheduled batch; links to ComfyUI notifications and Profile email campaigns

- **Completion notifications** — optional browser notifications when ComfyUI jobs finish (Settings)
- **Notification center** — in-app alerts bell in sidebar when jobs complete
- **Webhooks** — POST queue, prompt, and session events to an external URL via server proxy (`comfyui.job.*`, `prompt.generated`, `prompt.history.saved`, `session.recipe.saved`, scheduled batch)
- **Webhook event log** — Settings shows recent webhook deliveries with retry
- **Webhook log UI** — event filter and payload preview on Settings
- **Webhook templates** — Discord/Slack rich payload formats in Settings
- **Scheduled batch** — Settings configures periodic random-scene/topics generation (+ optional ComfyUI queue)
- **Server scheduled batch** — `SERVER_SCHEDULED_BATCH=true` or manual `POST /api/scheduled-batch/run`
- **Best-of-N campaigns** — scheduled profile or Automation tab runs optionally over-generate (2–4×) and LLM-rank prompts by text quality before queue; with **Vision-rank** enabled, queues all variants then vision-scores outputs and culls losers from the gallery; Profile server campaigns and headless server batch support the same path; `/api/best-of-n/rank-images` ranks generated images with `LLM_VISION_MODEL`
- **Prompt recipes API** — `/api/recipes/run` executes lint/fix/compact/queue chains server-side; result panels call it from Recipes & shootout shortcuts
- **Email notifications** — SMTP alerts for invites, password reset, batch/campaign completion, and password changes (Settings → Users → SMTP; Profile → Email)
- **Docker Compose** — `docker compose up` for app + Ollama (+ optional ComfyUI profile)
- **GitHub Actions CI** — runs unit tests, build, and Playwright smoke on push/PR

## UI & UX {#ui-ux}

- **Workspace modes** — Play (first-run default), Simple, Studio, or Full from the sidebar footer or Profile → Appearance; the saved mode is applied on first paint
- **Unified first-run path** — Welcome, Settings Heal, and first-queue modal share dismiss state; onboarding leads with Comfy → workflows → Generate (`/?source=random`) before optional LLM
- **Post-Heal checklist** — Connection first-run card lists Generate → Queue → Gallery review after Heal succeeds
- **Active jobs chip** — sidebar and mobile header show live queue count with a deep link to `/queue`
- **Mobile Studio offer** — narrow viewports get a dismissible banner to open `/m`
- **Lean gallery discovery** — tip strip teaches Select → Compare / Collect / Group when nothing is selected
- **Gallery group management** — Groups rail plus rename/delete for custom groups
- **Semantic search inline** — Match chip sits next to gallery search (non-lean)
- **First-success tray nudge** — first lean-mode completed render uses notification + celebrate even when toasts are muted
- **Visual polish** — restrained button/chip motion (no lift/glow), solid docks instead of stacked glass bars, quieter gallery overlays and menu labels, ToolBadge without pill chrome, Settings jump via select. Default (comfortable) density tightened toward studio tooling; Play campaign active steps use real accent tokens; Dashboard elevates Play as the primary path when not resuming a draft.
- **First-run queue deep link** — post-Heal checklist and `/?source=random&autogen=1&autoqueue=1` auto-generate + queue a random scene
- **Dashboard output actions** — Re-queue, Refine, Roleplay, Edit, Hints on recent stills
- **Command palette context** — active project, recent gallery outputs, Heal & ready action
- **Mobile gallery filters** — layout/density/rating as selects on narrow viewports
- **Home dashboard** — pending ComfyUI jobs, recent outputs, and active project on `/dashboard`
- **Onboarding checklist** — Dashboard getting-started steps
- **Command palette** — `Ctrl+K` / `⌘K` quick navigation across tools
- **Keyboard shortcuts** — Ctrl+Enter generate, Ctrl+Shift+C copy pair, Ctrl+Shift+G queue ComfyUI; `/` focuses scene preset search
- **Keyboard shortcut editor** — customize bindings on Profile
- **Light theme** — Profile → Appearance switches Auto / Light / Dark
- **Ambient background** — subtle animated orbs; intensity toggle on Profile → Appearance
- **UI density & calm mode** — compact spacing and reduced motion on Profile → Appearance
