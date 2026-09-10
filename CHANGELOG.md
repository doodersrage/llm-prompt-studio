# Changelog

All notable changes to Prompt Studio, one section per release. Generated from git history
(release boundaries are the repo's own `Release vX.Y.Z` commits, since not every tag is
mirrored to every clone). Full release notes with installer/image links are on
[GitHub Releases](https://github.com/doodersrage/llm-prompt-studio/releases).

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Diffusers engine: ControlNet preprocessors for lineart / anime lineart / soft-edge (HED) / normal (BAE) / MLSD via `controlnet-aux`, plus Comfy class aliases (`OpenposePreprocessor`, `DepthAnythingPreprocessor`, …); xinsir Union `control_mode` maps softedge→2 / lineart·mlsd→3 / normal→4.
- Diffusers engine: Qwen InstantX ControlNet-Inpainting (mask-channel) via `QwenImageControlNetInpaintPipeline`; plain Union CN stays txt2img-only (no Img2Img CN).
- Diffusers engine: classic Flux ControlNet × img2img/inpaint (InstantX Union `control_mode` mapped canny→0 / depth→2 / pose→4); Qwen ControlNet stays txt2img-only (no Img2Img CN; mask-channel Inpaint CN unverified).
- Diffusers engine: SDXL ControlNet × img2img/inpaint and IP-Adapter × txt2img/img2img/inpaint (± ControlNet) compile natively (plain/Union); Flux/Qwen ControlNet stays txt2img-only.
- Diffusers engine: native SDXL IP-Adapter identity lock (`IPAdapterModelLoader` / `IPAdapterAdvanced`); FaceID/PuLID Comfy drop-ins fall back to hub Plus weights; InstantID/PuLID/FaceDetailer stay on Comfy.
- Diffusers engine: native Final/Max enrich polish — `UpscaleModelLoader` / `ImageUpscaleWithModel` via Spandrel (Comfy `upscale_models/*.pth`) plus `ImageScaleBy` / `ImageBlur`.
- Diffusers engine: Flux T5 `t5xxl_*_fp8_scaled` loads locally via `.scale_weight` dequant (no hub TE2 re-download); ControlNet pose (`DWPreprocessor` / OpenPose) and depth (`DepthAnythingV2Preprocessor` / MiDaS) compile natively with `controlnet-aux`; Union `control_mode` maps openpose→0 / depth→1 / canny→3.
- Diffusers engine: load Comfy `qwen_2.5_vl_7b_fp8_scaled.safetensors` by dequantizing per-layer `.scale_weight` into the pipeline dtype (no hub bf16 re-download when CLIPLoader points at the smaller file).
- Diffusers engine: native Canny/OpenPose/depth ControlNet for SDXL + classic Flux + Qwen, with safetensors-header sniffing to auto-detect "Union" checkpoints (ControlNetUnionModel + control_mode), reject unsupported XLabs-style Flux ControlNets and DiffSynth-style Qwen ControlNet "model patches" up front instead of failing deep in a torch error, and reject the mask-conditioned Qwen ControlNet-Inpainting checkpoint variant (unverified pipeline signature) in favor of the plain Union/Canny one; native inpaint for Flux + Qwen (previously SDXL-only). Flux2-Klein ControlNet/inpaint, InstantID/PuLID, FaceDetailer, and video stay on ComfyUI (SDXL IP-Adapter is native — see Unreleased IP-Adapter note).
- Diffusers engine: fix ControlNetUnionModel/FluxControlNetModel/QwenImageControlNetModel failing to load on diffusers releases where `.from_single_file()` doesn't cover those classes ("FromOriginalModelMixin is currently only compatible with [...]") — found via GPU smoke test on real checkpoints. Falls back to fetching the small hub config and loading the already-local checkpoint's weights into it, verifying the state dict actually matches before use.
- Diffusers engine: add `scripts/gpu_smoke_test.py`, a manual (non-unittest) smoke test that runs the SDXL/Flux/Qwen ControlNet and Flux/Qwen inpaint code paths against real checkpoints on a real GPU.
- Diffusers engine: fix two GPU-smoke-test-found bugs in Qwen img2img/inpaint — the VAE was force-parked to CPU before the text-encoder step and never moved back for img2img/inpaint (needs it resident on GPU to encode the init image mid-call), and a silent "fall back to prompt=" on any text-encoder-embed failure could re-run encode_prompt() with the encoder stuck on CPU, producing float32 embeddings that crashed deep in the transformer with a dtype mismatch. Both paths now fail loud with the real error instead. Also fixed the smoke test itself pointing Qwen tests at the fp8-scaled text encoder file, which the drop-in loader always rejects by design — switched to the bf16 file.
- Compose: multi-image Transfer scan — vision-reads filled slots and writes a transfer instruction (pose/people, people→pose+scene, outfit, background, style/light, hair, expression recipes).

## [v1.6.0] - 2026-09-06

- Desktop: Arch-safe `.deb` install script (`desktop/scripts/install-from-deb.sh`); first launch auto-runs Heal & ready (`?heal=1`).
- Cast LoRA flywheel: keeper strip, train progress bar, faster poll while running, Prove-it Gallery deep-link.
- Play film: ffmpeg/assemble failures route through the queue failure playbook on Day, Roleplay, and mobile; e2e covers assemble 503.
- Plugins: install denoise example to server, auto-sync after install, PROMPT_DATA_DIR readiness note.
- Diffusers: stills-only (no longer labeled experimental); ensure-on-select via `/api/diffusers/ensure`.

## [v1.5.5] - 2026-09-05

- Linux AppImage: un-bundle libwayland* and stop forcing GDK_BACKEND=x11 so host Mesa/EGL can use DMA-BUF without the slow WEBKIT_DISABLE_DMABUF_RENDERER hammer.
- Docs: prefer Linux `.deb` (system WebKit/Skia GPU) over AppImage on rolling distros.

## [v1.5.4] - 2026-09-05

- Fix Linux AppImage black-window crash by defaulting WEBKIT_DISABLE_DMABUF_RENDERER=1 before WebKit init.

## [v1.5.3] - 2026-09-05

- fix: stage only CPU onnxruntime libs for desktop AppImage

## [v1.5.2] - 2026-09-05

- Fix Linux AppImage packaging: vendor onnxruntime native libs into the desktop stage, set NO_STRIP/ARCH for linuxdeploy, and upload .deb even if AppImage fails.

## [v1.5.1] - 2026-09-05

- Ship a Linux `.AppImage` desktop artifact alongside `.deb` on GitHub Releases.
- Fix clothing-mutations test typings and silence LoRA turbopack path-tracing warnings so `pnpm run build` typechecks cleanly.

## [v1.5.0] - 2026-09-05

- Server film encode via `/api/film/assemble` (ffmpeg H.264/AAC) for Day, Roleplay Cut, and gallery stitch, with clearer errors and a credentialed browser fallback.
- Cast LoRA flywheel: Export → Train writes datasets under `PROMPT_DATA_DIR`, durable jobs in SQLite, register/pin into Comfy, and prove-it validation stills.
- Runway as a first-class cloud engine (Gen-4 stills, Gen-4.5 T2V/I2V, Aleph continue).
- Mobile Studio `/m` as a phone-first Capture → Moodboard → Fitting → Day → Play loop with Cut/Save to Cast.
- Compose cloud identity: expanded multi-ref registry and honest face-ref vs prompt-identity paths.
- Server plugins under `PROMPT_DATA_DIR/plugins` with privileged Comfy queue-preflight/post hooks and a richer iframe host protocol.
- Fix gallery stitch CORS by resolving gallery/Comfy/cloud clip bytes in-process on the server.
- Restyle and expand GitHub Pages docs for Prompt Studio.
- Broad unit-test coverage sweep across `src/lib` (auth, film, gallery, engines, and more).
- Maintenance: static-import `listUsers` in server user maintenance so CI mocks stay consistent; consolidate shared helpers and mega-file decompositions.

## [v1.4.21] - 2026-08-28

- Tighten Play stall CTAs and queue failure playbook deep-links.
- Lazy-load keyboard shortcuts help and optimize dexie imports.
- Split remaining near-mega tools and add first-film funnel e2e.
- Align size-limit peer deps so Release npm ci resolves.
- Document aggregate client chunk size budget for npm run size.
- Ship Play stall CTAs, queue failure e2e, and workflow save/queue coverage.
- Finish full mega-file decomposition across tools, hooks, nav, and settings.
- Split prompt-result and gallery hooks, add Play funnel stall metrics.
- Add FittingRoomToolSections omitted from mega-file decomposition commit.
- Decompose all remaining component mega-files into orchestrators and sections.
- Finish mega-file decomposition with grouped gallery props and tool orchestrators.
- Extract video model sync and roleplay bio/scene/session hooks.
- Extract gallery lightbox/status/auxiliary slots and video result section.
- Extract gallery filters/grid sections and video form hooks.
- Extract video scaffold and gallery bulk toolbar sections.
- Extract video queue hook and gallery panel cap/modals slots.
- Remove unused imports after RoleplayTool hook extraction.
- Decompose RoleplayTool into reference, beat queue, and deep-link hooks.
- Fix vision scan on video clips and harden large image uploads.
- Extract useGalleryPanelOrchestration from ComfyUiGalleryPanel.
- Extract ImageLightbox shell, header, and slide chrome bindings.
- Extract shared ImageLightbox bottom chrome component.
- Extract gallery panel body and lightbox presentation hook.
- Extract generation settings hook and gallery card renderer.
- Extract shared tool model/workflow hook and gallery lightbox bindings.
- Extract gallery display plan and recovery hooks from panel.
- Extract ImageLightbox slide, stage, filmstrip, and nav components.
- Extract lightbox stage and gallery browse hooks; fix ref lint.
- Extract fitting queue and lightbox keyboard hooks; harden release push.
- Extract gallery filters/lightbox hook and SharedTool advanced stack.
- Decompose lightbox/gallery mega UI and harden heal e2e rails.
- Close the post-film habit loop and fail-fast ops e2e in CI.
- Make Play metrics actionable and harden ops e2e rails.
- Split mega UI modules, add ops e2e, and harden catalog/compose hygiene.
- Tighten Play first-film path, mobile companion, and exposed auth defaults.
- Fix Settings e2e strict-mode from locator.or().
- Close Play finished-state loop after Day/Roleplay Cut.
- Stop re-calling revealFullSettings after opening ComfyUI tab.
- Eager-load CommandPalette when Playwright is enabled.
- Harden smoke e2e against CommandPalette mount races.
- Fix automation e2e strict-mode on Scheduled batch Auto-queue.
- Close Play Cut loop with Roleplay deep-links and funnel metrics.
- Fix Play e2e strict-mode and deepen Cut→Cast film paths.
- Let any Cast continue in Roleplay and keep campaign steps in sync.
- Close Keep→Day, Cut→Cast, and mobile desk gaps before v1.4.8.
- Harden Play campaign sync, resume, share UX, and onboarding funnel.
- Surface Play film metrics and make share, resume, and handoffs durable.
- Track first-film success and tighten Play resume, import, and CI.
- Harden the Play loop with campaign e2e, look-pack share, and clearer IA.
- Fix Play typing, look-pack handoffs, and draft queue param gaps.
- Fix Moodboard tile label and notes eating Space while typing.
- Add Play campaign and fast Fitting Room draft kit previews.
- Finish Play Fitting, Day, and Moodboard beyond the stills MVP.
- Add cancel controls to the system tray and generating status panel.
- Exclude profession kits from non-work wardrobe rolls.
- Fix e2e strict-mode locators and mount shell immediately under Playwright.
- Harden Queue, Gallery, and Heal against real multi-GPU flakiness.
- Harden vision uploads, slim Simple nav, and clarify the first-run loop.
- Add Logo tool with instant SVG export and raster prompt queue.
- Fix wardrobe catalog key order for production typecheck.
- Add Play Fitting Room, Day Planner, and Moodboard tools.
- Housekeeping: canonical repo metadata, CI fixes, drop violet accent type.
- Extend calm UX: first-run auto-queue, palette context, mobile filters.
- Calm UI chrome: quieter galleries, flatter motion, brand accents.
- Improve first-run UX, gallery discovery, and live job feedback.
- Persist gallery page across nav and reload; UX cohesion pass.
- Fix missing shouldSkipGalleryThumbProxy import in view route.
- Add gallery groups, audio/3D media, vision scan, and workspace polish.
- Fix LoRA id collisions and spoofable rate-limit key; parallelize gallery/dataset export fetches and cache catalog search
- Add version-check routine that alerts on new releases
- Fix N+1 sequential API calls, auth gaps, and gallery data-integrity bugs; resolve experiment-block pagination sticking
- various bug fixes and optimizations
- Add video stitching for gallery clips with range-request streaming and a media-request rate limit
- Fix gallery lineage grouping, poll-resume masking, and queue-run ID collisions; trim dataset export overcounting and cache/prefetch overhead
- Close Roleplay episodes at 12 panels instead of dropping old beats.
- Keep clip queues on video graphs instead of the still-image picker.
- Stop treating ComfyUI canvas Note nodes as missing custom packs.
- Queue roleplay clip scenes as T2V instead of generating a still first.
- Queue txt2img when an edit workflow has no source image.
- Give roleplay clips a still-style regenerate instead of inheriting the last frame.
- Add a vision scan on Video I2V first frames.
- Make Play continuity honest: story forks, Cast restore, and Fal extend.
- Point Docker install snippets at the GHCR semver tag (1.1.0), not the git tag (v1.1.0).
- Allow republishing an existing release tag so a GitHub 503 on release create does not skip desktop and Docker.
- Skip hovering the Exact graph badge in gallery e2e; the card image intercepts pointer events.
- Unblock gallery exact-replay e2e by asserting the status toast instead of a Comfy POST that preflight never reaches.
- Make gallery exact-replay e2e wait on the Comfy POST and a stable status node.
- Add Play workspace and play generated clips in place of flattened stills.
- Queue LTX Video on euler/simple and a separate T5 CLIPLoader so distilled checkpoints no longer fail on KSampler scheduler ltxv or CLIP None.
- Add Install rows for WAN Rapid AIO SFW, Lightning 4-step high-noise LoRAs, and current LTX 0.9.8 distilled checkpoints.
- Point public links and the Docker image name at llm-prompt-studio so Releases, GHCR, and the docs site use the same repo.
- Fall back to a built-in video I2V graph when the selected workflow is stills-only, and load Hunyuan/WAN diffusion UNETs through UNET+CLIP+VAE instead of CheckpointLoaderSimple.
- Give Video and Gallery the same Fal extend vs last-frame continue as Roleplay, wire documented Grok and Gemini video, and match Settings and docs to that matrix.
- Call documented Fal LTX extend for public parent clips, stamp the already-cut Roleplay film on Save to Cast, and add Replicate LTX presets.
- Let a Roleplay story become a film, tell the truth about last-frame I2V and cloud identity lock, and wire documented Fal LTX, Grok Imagine, and Veo clip presets.
- Finish leftover clip and Compose follow-through so Lightning packs, Roleplay T2V, Replicate clips, and cloud multi-ref match what the UI claims.
- Close the clip loop: Fal T2V, still-to-video handoff, and Compose Image 2 staying Image 2.
- Close the Cast LoRA flywheel and stop Compose leftover from landing on a character.
- Let a character's reel become a film: watch, cut, assemble, and take it home.
- Keep Cast in sync with Roleplay: stamp the right character, and let you remove one.
- Turn Roleplay into a film reel: clip beats, extend lineage, and Fal I2V.
- Make the character the project: home, looks, and keeper-to-LoRA.
- Unify identity into Character OS and close still-to-video and cloud img2img loops.
- qwen 2511 default text encoder fix
- Make first-run Connection → Generate → Queue → Gallery obvious.
- Fix Settings e2e flakes and ship Linux desktop as .deb only.
- Ship Linux .deb even when AppImage linuxdeploy fails in CI.
- Stop tracking local studio.sqlite so machine data stays off the remote.
- Enable GitHub Pages and publish docs on main.
- Fix macOS desktop hang by resolving the bundled Node sidecar and server path.
- Fix Linux desktop bundling, first-run setup, and Settings deep-link e2e.
- Pin Tauri crates to published versions so desktop CI can resolve.
- Gate adult roleplay behind the NSFW env flags and add a Tauri desktop release.
- comfyui branding adjust
- more role play bugs
- more role play tweaks
- Add a roleplay session library and use the stock Qwen 2.5-VL clip filename.
- more role playing
- more roleplay tone options
- upload your own files to gallery
- report a bug link
- roleplay retry
- Export static Next.js route runtime for OpenAI, Gemini, and Grok.
- Add ChatGPT, Gemini, and Grok as cloud txt2img engines.
- Treat missing LoRA previews as empty instead of 404.
- Add Replicate as a second cloud txt2img engine beside Fal.
- Add Fal as a cloud txt2img engine beside ComfyUI.
- more ci errors
- ci errors
- subject isolation problem
- Skip Husky during Docker npm ci so release images can build.
- Add a Release workflow so v* tags publish GitHub Releases and GHCR images.
- hopefully last role play tweaks
- ci e2e errors
- basic mobile first options
- more role play
- role play i2i t2i switch
- more role play tweaks
- more role play options
- roleplay forking issue
- ci test fixes
- CI fix
- readme update
- more roleplay options
- extra role play tone
- download story
- role play feature
- Sit Alerts beside the sidebar Connected chip so it does not spend a whole footer row.
- Let a browser pick OpenRouter or Groq with its own key so generation is not stuck on a local LLM.
- Put model, quality, last look, and a locked face in a session strip, hide the rest behind Advanced, and make Queue the one result action.
- Land gallery actions on the still's tool, persist thumbs and locked faces, and keep looks on a new browser.
- Re-upload a locked face when its host is down, show the still's negative on Generate, and carry the stack into Variations.
- Pin identity queues to the host that has the face, restore sampler and size with the stack, and send prompt plus stack from the gallery.
- Close the remaining Generate loops: lock a still as the face, pull the server session, and save a look from a keeper.
- Restore a still's Generate stack, treat SQLite as the live gallery, and lock identity from the sidebar.
- Show pool queue depth and per-host Heal progress.
- Wait for ComfyUI after restart and walk the pool for imports.
- Finish Manager install, jobs polling, and host-import loops.
- Close the remaining ComfyUI product loops.
- even tighter comfyui api integration
- tighter comfyui api integration
- backend json to sqllite migration
- qwen 2512 tweaks
- lora filter and downloader
- e2e test fixes
- minor tweaks
- Document Heal & ready, second GPU, backup v5, and invite SMTP.
- Let operators add a GPU, restore a studio, and invite users from Settings.
- Put remaining operator knobs in Settings and harden pool failover.
- last round of gallery features
- code cleanup
- just for fun
- backend persistence
- klen 9b distilled tweaks
- Unify remaining UI chrome onto design tokens.
- aesthetic leveling
- flux2 klein optimizations
- image upscale problems
- model scaffolding adjust
- Fix gallery lightbox e2e deep-link race and Compose pick CTA layout.
- Close remaining Prompt→Queue→Edit workflow gaps and fix gallery selection checks.
- Unify edit/media handoffs with Ctrl+Enter, Studio routing, and continue-edit parity.
- Tighten Prompt/Scene/Edit handoffs, recipes, and continue-edit flow.
- Add gallery facets, bulk rate, shareable views, and param diffs.
- Polish lightbox actions rail, note badges, and CORS-safe histograms.
- Add compact lightbox actions, seed variations, and review notes.
- Expand lightbox with pair/B-A modes, deep links, and overflow-safe chrome.
- Overhaul lightbox: review chrome, zoom/pan, and gallery entry actions.
- Overhaul gallery: crown winners, experiment clusters, and recovery UX.
- Fix experiments layout, expand asset downloads, and slim Settings.
- Stabilize remaining flaky e2e assertions.
- Align e2e expectations with current tool titles and Studio mode.
- Fix gallery e2e when workspace defaults to Simple.
- Add history density, gallery restore, and reliability UX loops.
- Fix history virtualization and denser gallery layout.
- Add reliability strip, graph byte budgets, and setup funnel metrics.
- Harden settings sync, queue playbooks, gallery hygiene, and plugin allowlist.
- Surface exact-replay, lineage filters, and stronger failure routing.
- Add settings sidecars, gallery workflow replay, and queue playbooks.
- Add setup, plugin queue, editor, and media reliability improvements.
- bug fixes
- Document gallery compare modal decomposition in features.
- Decompose gallery panel: compare modal, paginator, and handlers hook.
- Wire Settings prompt recipe runner to /api/recipes/run.
- Add vision-rank observability metrics and wire recipe panels to API.
- Complete vision-rank automation and collab sprint expansions.
- Add ComfyUI pool load balancing by queue depth.
- Wire vision best-of-N, collab apply, and automation parity.
- Document collab persistence and experiment virtualization in features.
- Add collab persistence, LTX I2V splice, and experiment virtualization.
- Expand automation hub, gallery caps, and client-safe best-of-N.
- Add deferred img2img, scaffolds, and virtualized history.
- Wire per-model LoRA overrides, backup v4, and automation backlog.
- Expand adult generator UX, session recipes, and automation hooks.
- Add env-gated adult generator plugin with 126 presets.
- lora stack optimization
- Add inline model and clip strength controls to LoRA stack picker.
- Increase prompt history cap to 500 and paginate Studio history tab.
- Final UX polish: canonical labels, lean gallery, hub copy.
- Extract all remaining Studio tabs as lazy modules.
- Split Settings and Studio tabs for leaner bundles.
- Lean Gallery and scene tools; unify hub page copy.
- Unify lean UX: design tokens, lazy Studio tabs, Simple descriptions.
- more UI/UX
- UI/UX pass again
- more UI/UX
- UI/UX overhaul
- UI/UX changes
- boogu turbo problems
- z-image and boogu native support
- toast and system tray location merge
- auto-retry failed downloads
- system tray bug fixes
- Boogu Image-Edit initial support
- z-image compose integration
- initial z-image support
- app wide system activity tray
- gallery fixes cleanups UX and code
- github docs deploy fix
- readme cleanup
- Fix TypeScript errors blocking CI build
- fix ci failures
- compose image prompt syntax adjust
- more compose templates
- more compose tweaks
- denoise and compose templates
- more bug fixes
- klein 9b distilled tweaks
- qwen compose workflow mods
- gallery tweaks
- image scaling issue
- denoise overiride fix
- denoise override settings
- new seed update
- anatomy features adjust
- list selected loras
- klein enhance node options
- kleign enhance other bugs and features
- ksampler overrides shared settings cleanup
- tab sync, poller auth gate, onboarding gating, command palette fixes, etc.
- minor bug fixes
- more ci test fixes
- anatomy guard tweaks
- e2e ci fixes
- optimization fixes
- bug fixes
- playright fix
- ci error fixes
- gallery download original option
- gallery mods
- error fixes and optimizations
- bug fixes
- more performance optimizations
- performance optimizations
- prettier
- small optimizations
- fix tests
- yep, more bugs
- sqaushing a bunch of bugs
- more tweaks
- klein 9b distilled tweaks
- ci errors fix
- gallery tweaks
- flux.2 kleign 9b base optimizations
- UltraReal Fine-Tune v4 checkpoint local app support
- flux.2 klein 9b base optimizations
- gallery, topics, and other various fixes
- fix app load themeColor viewport warning
- default aio and fix ci errors
- klein compose support
- qwen rapid aio lora fix
- qwen rapid aio fix
- qwen 2512 lightening tweak
- gen prompt tweaks
- Fix Turbopack panic from Diffusers .venv symlinks under the Next tree.
- Fix CI typecheck on storage-merge and keep Diffusers autostart out of NFT.
- more test fixes
- diffuser (left at experimental), various
- more diffusers debug
- Add Diffusers multi-checkpoint listing and Studio picker.
- diffusers v1
- sdxl diffusers
- diffuser build in progress
- gallery lora seed fix
- minor fixes
- docs
- refine error fix
- qwen lora load fix
- fix soft-pass denoise typing blocking CI build
- more pipeline optimizations
- new user onboarding
- gallery soft second pass option
- downloader expansion
- wardrobe rebuild
- image and video quality optimizations
- wan rapid aio gallery select bug
- video gen edits
- more test fixes
- wan lighting model
- ci test fix
- new per model lora system and various bug fix
- pm2 config file
- final optimization and debug
- final debug, I hope
- various
- nearly comlete
- ui sprint
- final feature sprint
- another feature spring
- various fixes and features
- Lora library
- bunch of new stuff
- workflow system auto-scaffolding
- many new features
- another round of features
- real time latent image
- another big round of features
- many new features
- settings
- prompt optimization
- various tweaks
- pipeline optimizations
- pipeline tweaks
- image and gallery tweaks
- gallery remove selected
- gallery image optimizations
- more ui including gallery
- more ui
- more ui
- more ui changes
- ui changes
- image gen optimization
- app optimizations
- more optimizations
- more optimizations
- many tweaks
- prompt queue bug
- ci test fix
- minor stuff
- clothing fixes
- more app optimizations
- live comfyui job progress update
- app optimizations and fixes
- more pipeline optimizations
- copmfyui pipeline optimizations
- error fixes
- more pipeline stuff
- pipeline cleanup
- lots of fixes
- more features and fixes
- various fixes
- Add model-aware workflow optimize, health actions, and ControlNet patching.
- Close reliability gaps: sidecar parity, loader health, and gallery workflows.
- Add gallery lineage UX, workflow health audit, and rating-driven negatives.
- Extend gallery upscale workflow with bulk actions, lineage, and minimal refine.
- Upscale gallery outputs on high ratings instead of re-rolling seeds.
- Fix 5★ gallery auto-requeue failures and expand loader map defaults.
- Harden workflow takeover defaults for Final/Max quality pipelines.
- lost of new stuff
- auto select workflow based on image model selection
- various fixes
- more fixes and tweaks
- fixes and optimizations
- gallery optimization
- error fixes and optimizations
- error repair
- more features
- more features
- more features and cleanup
- app background
- more features
- more features
- user system fixes
- user system
- fixes and features
- cleanup and more features
- more fixes
- more features and fixes
- more new features
- security fixes and updates
- Update README.md
- even more features
- yep more features
- yep more features
- more features
- more features
- more new features
- more new features
- more features
- more cleanup
- more cleanup
- cleanup
- fantasy framing options
- fantasy clothing
- fantasy scene generator
- pet scene generator
- more gallery stuff
- even more tweaks
- more tweaks
- more tweaks
- more options
- more fixes
- ui/ux changes
- sport related fixes
- more comfyui workflow options
- ton of new features
- more sports
- sport and sport clothing fixes
- more clothing system optimizations
- more clothing tweaks
- more optimizations
- more random scenes
- even more clothing fixes
- more bug fixes
- more clothing fixes
- more clothing and bug fixes
- more clothing
- scene + gender clothing context
- lots of clothing options
- location cleanup
- even more locations
- now with 2,000 unique locations
- background presets
- exntended character builder options
- image prompt fixes
- more image model fixes
- location fix
- more random locations
- character expansion
- topic generator
- more active action prompt
- more comfyui node problems
- comfy ui tools tweak
- more fixes
- LLM fixes
- custom comfyuui node
- more features
- distinct people fix
- more model support + API
- existing text formatter tool
- model options
- prompt detail options
- multi-person generative options
- more generative variation
- seed variation slider
- seed more variation
- first commit

## [v1.4.20] - 2026-08-28

- Tighten Play stall CTAs and queue failure playbook deep-links.

## [v1.4.19] - 2026-08-28

- Lazy-load keyboard shortcuts help and optimize dexie imports.
- Split remaining near-mega tools and add first-film funnel e2e.

## [v1.4.18] - 2026-08-28

- Align size-limit peer deps so Release npm ci resolves.
- Document aggregate client chunk size budget for npm run size.
- Ship Play stall CTAs, queue failure e2e, and workflow save/queue coverage.

## [v1.4.17] - 2026-08-28

- Finish full mega-file decomposition across tools, hooks, nav, and settings.

## [v1.4.16] - 2026-08-28

- Split prompt-result and gallery hooks, add Play funnel stall metrics.
- Add FittingRoomToolSections omitted from mega-file decomposition commit.
- Decompose all remaining component mega-files into orchestrators and sections.
- Finish mega-file decomposition with grouped gallery props and tool orchestrators.
- Extract video model sync and roleplay bio/scene/session hooks.
- Extract gallery lightbox/status/auxiliary slots and video result section.
- Extract gallery filters/grid sections and video form hooks.
- Extract video scaffold and gallery bulk toolbar sections.
- Extract video queue hook and gallery panel cap/modals slots.
- Remove unused imports after RoleplayTool hook extraction.
- Decompose RoleplayTool into reference, beat queue, and deep-link hooks.

## [v1.4.15] - 2026-08-28

- Fix vision scan on video clips and harden large image uploads.

## [v1.4.14] - 2026-08-28

- Extract useGalleryPanelOrchestration from ComfyUiGalleryPanel.
- Extract ImageLightbox shell, header, and slide chrome bindings.

## [v1.4.13] - 2026-08-28

- Extract shared ImageLightbox bottom chrome component.
- Extract gallery panel body and lightbox presentation hook.

## [v1.4.12] - 2026-08-28

- Extract generation settings hook and gallery card renderer.
- Extract shared tool model/workflow hook and gallery lightbox bindings.
- Extract gallery display plan and recovery hooks from panel.
- Extract ImageLightbox slide, stage, filmstrip, and nav components.
- Extract lightbox stage and gallery browse hooks; fix ref lint.

## [v1.4.11] - 2026-08-27

- Extract fitting queue and lightbox keyboard hooks; harden release push.
- Extract gallery filters/lightbox hook and SharedTool advanced stack.
- Decompose lightbox/gallery mega UI and harden heal e2e rails.
- Close the post-film habit loop and fail-fast ops e2e in CI.
- Make Play metrics actionable and harden ops e2e rails.

## [v1.4.10] - 2026-08-27

- Split mega UI modules, add ops e2e, and harden catalog/compose hygiene.
- Tighten Play first-film path, mobile companion, and exposed auth defaults.

## [v1.4.9] - 2026-08-27

- Fix Settings e2e strict-mode from locator.or().
- Close Play finished-state loop after Day/Roleplay Cut.

## [v1.4.8] - 2026-08-27

- Stop re-calling revealFullSettings after opening ComfyUI tab.
- Eager-load CommandPalette when Playwright is enabled.
- Harden smoke e2e against CommandPalette mount races.
- Fix automation e2e strict-mode on Scheduled batch Auto-queue.
- Close Play Cut loop with Roleplay deep-links and funnel metrics.
- Fix Play e2e strict-mode and deepen Cut→Cast film paths.
- Let any Cast continue in Roleplay and keep campaign steps in sync.

## [v1.4.7] - 2026-08-26

- Close Keep→Day, Cut→Cast, and mobile desk gaps before v1.4.8.
- Harden Play campaign sync, resume, share UX, and onboarding funnel.
- Surface Play film metrics and make share, resume, and handoffs durable.
- Track first-film success and tighten Play resume, import, and CI.
- Harden the Play loop with campaign e2e, look-pack share, and clearer IA.
- Fix Play typing, look-pack handoffs, and draft queue param gaps.
- Fix Moodboard tile label and notes eating Space while typing.

## [v1.4.6] - 2026-08-26

- Add Play campaign and fast Fitting Room draft kit previews.

## [v1.4.5] - 2026-08-25

- Finish Play Fitting, Day, and Moodboard beyond the stills MVP.

## [v1.4.4] - 2026-08-25

- Add cancel controls to the system tray and generating status panel.

## [v1.4.3] - 2026-08-25

- Exclude profession kits from non-work wardrobe rolls.
- Fix e2e strict-mode locators and mount shell immediately under Playwright.
- Harden Queue, Gallery, and Heal against real multi-GPU flakiness.

## [v1.4.2] - 2026-08-24

- Harden vision uploads, slim Simple nav, and clarify the first-run loop.

## [v1.4.1] - 2026-08-23

- Add Logo tool with instant SVG export and raster prompt queue.

## [v1.4.0] - 2026-08-23

- Fix wardrobe catalog key order for production typecheck.

## [v1.3.2] - 2026-08-23

- Add Play Fitting Room, Day Planner, and Moodboard tools.

## [v1.3.1] - 2026-08-23

- Housekeeping: canonical repo metadata, CI fixes, drop violet accent type.
- Extend calm UX: first-run auto-queue, palette context, mobile filters.
- Calm UI chrome: quieter galleries, flatter motion, brand accents.
- Improve first-run UX, gallery discovery, and live job feedback.

## [v1.3.0] - 2026-08-21

- Persist gallery page across nav and reload; UX cohesion pass.

## [v1.2.2] - 2026-08-20

- Fix missing shouldSkipGalleryThumbProxy import in view route.
- Add gallery groups, audio/3D media, vision scan, and workspace polish.
- Fix LoRA id collisions and spoofable rate-limit key; parallelize gallery/dataset export fetches and cache catalog search
- Add version-check routine that alerts on new releases

## [v1.2.1] - 2026-08-20


## [v1.2.0] - 2026-08-17

- Fix N+1 sequential API calls, auth gaps, and gallery data-integrity bugs; resolve experiment-block pagination sticking
- various bug fixes and optimizations
- Add video stitching for gallery clips with range-request streaming and a media-request rate limit
- Fix gallery lineage grouping, poll-resume masking, and queue-run ID collisions; trim dataset export overcounting and cache/prefetch overhead
- Close Roleplay episodes at 12 panels instead of dropping old beats.
- Keep clip queues on video graphs instead of the still-image picker.
- Stop treating ComfyUI canvas Note nodes as missing custom packs.
- Queue roleplay clip scenes as T2V instead of generating a still first.
- Queue txt2img when an edit workflow has no source image.
- Give roleplay clips a still-style regenerate instead of inheriting the last frame.
- Add a vision scan on Video I2V first frames.

## [v1.1.0] - 2026-08-17

- Make Play continuity honest: story forks, Cast restore, and Fal extend.
- Point Docker install snippets at the GHCR semver tag (1.1.0), not the git tag (v1.1.0).
- Allow republishing an existing release tag so a GitHub 503 on release create does not skip desktop and Docker.

## [v1.0.2] - 2026-08-17

- Skip hovering the Exact graph badge in gallery e2e; the card image intercepts pointer events.
- Unblock gallery exact-replay e2e by asserting the status toast instead of a Comfy POST that preflight never reaches.
- Make gallery exact-replay e2e wait on the Comfy POST and a stable status node.
- Add Play workspace and play generated clips in place of flattened stills.

## [v1.0.1] - 2026-08-16

- Queue LTX Video on euler/simple and a separate T5 CLIPLoader so distilled checkpoints no longer fail on KSampler scheduler ltxv or CLIP None.
- Add Install rows for WAN Rapid AIO SFW, Lightning 4-step high-noise LoRAs, and current LTX 0.9.8 distilled checkpoints.
- Point public links and the Docker image name at llm-prompt-studio so Releases, GHCR, and the docs site use the same repo.

## [v1.0.0] - 2026-08-16

- Fall back to a built-in video I2V graph when the selected workflow is stills-only, and load Hunyuan/WAN diffusion UNETs through UNET+CLIP+VAE instead of CheckpointLoaderSimple.

## [v0.9.0] - 2026-08-16

- Give Video and Gallery the same Fal extend vs last-frame continue as Roleplay, wire documented Grok and Gemini video, and match Settings and docs to that matrix.

## [v0.8.0] - 2026-08-16

- Call documented Fal LTX extend for public parent clips, stamp the already-cut Roleplay film on Save to Cast, and add Replicate LTX presets.

## [v0.7.0] - 2026-08-16

- Let a Roleplay story become a film, tell the truth about last-frame I2V and cloud identity lock, and wire documented Fal LTX, Grok Imagine, and Veo clip presets.

## [v0.6.0] - 2026-08-16

- Finish leftover clip and Compose follow-through so Lightning packs, Roleplay T2V, Replicate clips, and cloud multi-ref match what the UI claims.

## [v0.5.0] - 2026-08-16

- Close the clip loop: Fal T2V, still-to-video handoff, and Compose Image 2 staying Image 2.

## [v0.4.0] - 2026-08-16

- Close the Cast LoRA flywheel and stop Compose leftover from landing on a character.

## [v0.3.11] - 2026-08-16

- Let a character's reel become a film: watch, cut, assemble, and take it home.

## [v0.3.10] - 2026-08-16

- Keep Cast in sync with Roleplay: stamp the right character, and let you remove one.

## [v0.3.9] - 2026-08-16

- Turn Roleplay into a film reel: clip beats, extend lineage, and Fal I2V.

## [v0.3.8] - 2026-08-16

- Make the character the project: home, looks, and keeper-to-LoRA.

## [v0.3.7] - 2026-08-16

- Unify identity into Character OS and close still-to-video and cloud img2img loops.

## [v0.3.6] - 2026-08-16

- qwen 2511 default text encoder fix

## [v0.3.5] - 2026-08-16

- Make first-run Connection → Generate → Queue → Gallery obvious.

## [v0.3.1] - 2026-08-15

- Fix Settings e2e flakes and ship Linux desktop as .deb only.
- Ship Linux .deb even when AppImage linuxdeploy fails in CI.
- Stop tracking local studio.sqlite so machine data stays off the remote.
- Enable GitHub Pages and publish docs on main.
- Fix macOS desktop hang by resolving the bundled Node sidecar and server path.
- Fix Linux desktop bundling, first-run setup, and Settings deep-link e2e.
- Pin Tauri crates to published versions so desktop CI can resolve.

## [v0.3.0] - 2026-08-14

- Gate adult roleplay behind the NSFW env flags and add a Tauri desktop release.
- comfyui branding adjust
- more role play bugs
- more role play tweaks
- Add a roleplay session library and use the stock Qwen 2.5-VL clip filename.
- more role playing
- more roleplay tone options
- upload your own files to gallery
- report a bug link
- roleplay retry

## [v0.2.0] - 2026-08-14

- Export static Next.js route runtime for OpenAI, Gemini, and Grok.
- Add ChatGPT, Gemini, and Grok as cloud txt2img engines.
- Treat missing LoRA previews as empty instead of 404.
- Add Replicate as a second cloud txt2img engine beside Fal.
- Add Fal as a cloud txt2img engine beside ComfyUI.
- more ci errors
- ci errors
- subject isolation problem
- Skip Husky during Docker npm ci so release images can build.

