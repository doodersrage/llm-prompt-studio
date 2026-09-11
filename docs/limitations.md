# Known limitations

Facts that are each documented somewhere already (feature pages, `.env.example`
comments, changelog entries), collected here in one place because "what does this
*not* do" tends to be exactly what a first-time visitor looks for before investing
setup time, and it's easy to miss when it's scattered across a dozen feature bullets.

## Generation engines

- **Diffusers is an optional stills sidecar — not the product bet.** txt2img/img2img
  through Diffusers works for stills, but Play film (Day, Roleplay clips, Cast video)
  always routes through ComfyUI or a cloud engine. Further Diffusers parity beyond the
  documented stills surface is **parked**; hard non-goals (PuLID, FaceDetailer, Dynamic
  VRAM, Boogu/GGUF, video, etc.) stay on Comfy.
- **Cloud clip support varies by provider.** Fal, Replicate, Grok, Gemini, and
  Runway can queue clips (T2V/I2V/extend, provider-dependent); ChatGPT is stills
  only. Check a provider's row in the model tables before assuming clip support.
- **Cloud identity lock is not the same feature as local identity lock.** Local
  ComfyUI uses IP-Adapter / InstantID / PuLID for face consistency. Cloud engines
  never get Comfy IP-Adapter — they use either a documented multi-ref face
  reference (when the endpoint supports it) or a weighted identity prompt, which
  is a real fidelity difference, not just a routing detail.
- **Cloud Compose transfer is single-reference by default.** Multi-image transfer
  (pose/scene/outfit donors from Images 2–4) works locally; on cloud it only works
  through a documented multi-ref edit model (Fal Kontext multi, FLUX.2 edit,
  nano-banana edit, or Replicate's multi-image Kontext) — otherwise transfer stays
  blocked rather than silently degrading to single-image behavior.

## Specialty tools (parked)

- **Topics, Audio, Mesh, Logo, and legacy Pet/Fantasy/Background pages are parked.**
  They remain reachable via ⌘K / direct URL / Character page switcher, but live under
  the sidebar **Extras** group (collapsed by default in Studio). The flagship product
  surface is the Play film loop plus Generate / Edit / Video / Gallery.

## Backup and data

- **Two backup mechanisms cover different scope — don't assume one implies the
  other.** The browser's one-click **Export backup** (Settings → Overview / Data)
  is the full picture: history, settings, gallery, ComfyUI config, presets, and
  the rest of `studio-extras`. The server-side automatic snapshots
  (`SERVER_USER_MAINTENANCE=true`) only capture prompt history and gallery per
  user — not settings, workflows, or LoRA jobs. Turning on scheduled maintenance
  is not a substitute for occasionally running the full browser export.
- **Server storage is opt-in.** Without `PROMPT_DATA_DIR` set, everything lives in
  browser storage on one machine/browser — no auth, no multi-device sync, no
  server-side backup snapshots are possible at all.

## Auth

- **No SSO/OAuth.** Accounts are username + password, optionally with TOTP 2FA.
  There's no external identity provider integration if that's a requirement for
  your deployment.
- **Auth-off is localhost-only.** Network-exposed signals (`PROMPT_EXPOSED`,
  all-interfaces bind, or a non-loopback `PROMPT_API_URL`) fail startup unless
  auth is enabled with real secrets (or `PROMPT_ALLOW_INSECURE_AUTH=1`).
- **Auth-on refuses insecure defaults.** If `PROMPT_AUTH_ENABLED=true` without
  `PROMPT_SESSION_SECRET` / `PROMPT_API_TOKEN` or without `PROMPT_ADMIN_PASSWORD`,
  the process exits at instrumentation time instead of signing cookies with a
  hardcoded secret or keeping the bootstrap admin on `"admin"`.

## Testing and platform

- **The accessibility check only covers five pages, and only two severities.**
  `npm run test:e2e:a11y` (`e2e/accessibility.spec.ts`) checks Generate, Gallery,
  Compose, Inpaint, and the Workflow editor for `critical`/`serious` axe-core
  violations — it does ride along in CI (the catch-all `npm run test:e2e` step
  at the end of the `e2e` job scans all of `e2e/`), but not as its own named,
  isolated gate, and a clean run says nothing about pages outside those five or
  about `moderate`/`minor` findings, which are logged rather than failed.
- **Linux AppImage is slower than the `.deb` on non-Ubuntu distros.** The
  AppImage embeds Ubuntu's WebKit; on Arch/Fedora and similar rolling distros it
  can feel sluggish compared to the `.deb`, which uses the system WebKit. See
  [docs/desktop.md](desktop.md).

## Where to look for anything not listed here

This list isn't exhaustive — it's the set of gaps that seemed likely to surprise
someone, not a full changelog of missing features. [docs/features.md](features.md)
is the actual feature-by-feature source of truth; if something's ambiguous there,
that's more reliable than this page.
