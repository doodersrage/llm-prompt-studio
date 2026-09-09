# Configuration & deployment

Environment variables, security, production checklist, and Docker. For Heal & ready, second GPU, backup restore, and invite email, start with the [operator guide](operator.md).

## Security notes

This app is designed for a **trusted local / LAN** setup. By default the HTTP API is open (CORS `*`) so ComfyUI custom nodes and CLI tools can call it.

When exposing beyond localhost:

1. Set `PROMPT_AUTH_ENABLED=true` (or create users under `PROMPT_DATA_DIR/auth/`) and sign in — default admin username/password come from `PROMPT_ADMIN_USERNAME` / `PROMPT_ADMIN_PASSWORD` (defaults: `admin` / `admin`; change immediately).
2. Set `PROMPT_API_TOKEN` — cross-origin and non-browser clients must send `Authorization: Bearer <token>` (same-origin UI still works). ComfyUI nodes read the same token from `PROMPT_API_TOKEN`. Service tokens bypass user login but should be kept secret.
3. Set `COMFYUI_ALLOW_CLIENT_URL=false` so callers cannot override the ComfyUI base URL (SSRF). Prefer `COMFYUI_ALLOWED_HOSTS` for a hostname allowlist.
4. Prefer binding to loopback (`127.0.0.1`) — default `docker-compose.yml` already does this. To publish beyond LAN use `docker compose --profile exposed up` (requires `PROMPT_SESSION_SECRET`, `PROMPT_ADMIN_PASSWORD`, `PROMPT_API_TOKEN`, and `PROMPT_API_URL`). Do not document or run `0.0.0.0` binds without auth.
5. Webhook dispatch blocks private/metadata URLs unless `WEBHOOK_ALLOW_PRIVATE=true`.
6. Set `PROMPT_API_URL` to the public origin so invite and reset emails are not `http://127.0.0.1:47832`.

## Production checklist

Before exposing Prompt Studio beyond a trusted LAN:

- [ ] Do not publish compose ports without `--profile exposed` (auth + secrets required)
- [ ] Confirm Settings → Overview shows Auth = accounts on
- [ ] Set strong `PROMPT_ADMIN_PASSWORD` and rotate after first login
- [ ] Set `PROMPT_SESSION_SECRET` (long random string; do not reuse API tokens)
- [ ] Enable `PROMPT_AUTH_ENABLED=true` and create non-admin users with blocked features as needed
- [ ] Set `PROMPT_API_TOKEN` for CLI/ComfyUI nodes; issue per-user `pt_…` keys from Profile when sharing access
- [ ] Configure SMTP (`PROMPT_SMTP_*` + `PROMPT_EMAIL_FROM`, or Settings → Users → SMTP) and send a test
- [ ] Set `PROMPT_API_URL` to the public origin used in invite / password-reset emails
- [ ] Set `COMFYUI_ALLOW_CLIENT_URL=false` and pin `COMFYUI_API_URL` or `COMFYUI_POOL`
- [ ] If using `COMFYUI_ALLOWED_HOSTS`, include every pool hostname (Settings cluster copies a snippet)
- [ ] Back up `PROMPT_DATA_DIR` (`studio.sqlite` plus `-wal`/`-shm`, leftover `*.json.imported`, export snapshots) on a schedule
- [ ] Export a studio backup JSON after the first real session (Settings → Overview)
- [ ] Run `npm run lint`, `npm test`, and `npm run test:e2e` before deploy (CI runs these on push)
- [ ] For Playwright with auth enabled locally, credentials load from `.env.local` (`PROMPT_ADMIN_*`) or set `PROMPT_E2E_USERNAME` / `PROMPT_E2E_PASSWORD`
- [ ] Hard auth lane: `PROMPT_AUTH_ENABLED=true` plus `npm run test:e2e:ops:auth` (`PROMPT_E2E_AUTH=1` fails closed if login is disabled or credentials fail)

**Batch tools:** Topics and Variations show per-row readiness scores; toggle **Ready only** before queueing. Workflow library **Apply bindings** injects `{{POSITIVE}}` / `{{NEGATIVE}}` placeholders from suggested node maps. Gallery **Tag untagged** backfills vision tags on completed entries.

## Docker

Published images (from [GitHub Releases](https://github.com/doodersrage/llm-prompt-studio/releases); see [Releases](releasing.md)):

```bash
docker pull ghcr.io/doodersrage/llm-prompt-studio:latest
docker run -d --name comfyui-prompt-studio --restart=always \
  -p 127.0.0.1:47832:47832 \
  -e LLM_API_BASE_URL=http://host.docker.internal:11434/v1 \
  -e LLM_MODEL=hermes3 \
  -e LLM_VISION_MODEL=gemma4:latest \
  ghcr.io/doodersrage/llm-prompt-studio:latest
```

Docker Hub (`doodersrage/llm-prompt-studio`) is updated on the same release when Hub secrets are set.

Build locally:

```bash
docker build -t qwen-image-prompt .
docker run --rm -p 127.0.0.1:47832:47832 \
  -e LLM_API_BASE_URL=http://host.docker.internal:11434/v1 \
  -e LLM_MODEL=dolphin-llama3 \
  -e LLM_VISION_MODEL=qwen3-vl:latest \
  qwen-image-prompt
```

On Linux, add `--add-host=host.docker.internal:host-gateway` if Ollama runs on the host. Override `PORT` only if you map a different host port.

**Publish beyond LAN (auth required):**

```bash
export PROMPT_SESSION_SECRET="$(openssl rand -hex 32)"
export PROMPT_ADMIN_PASSWORD='change-me'
export PROMPT_API_TOKEN="$(openssl rand -hex 24)"
export PROMPT_API_URL='https://studio.example.com'
docker compose --profile exposed up -d
```

Default `docker compose up` stays on `127.0.0.1` with auth off. Do not publish `0.0.0.0` without the `exposed` profile (or equivalent auth env).

## LLM configuration

The generator calls any **OpenAI-compatible** chat completions API. Configure via `.env.local`:

| Variable                               | Default                          | Description                                                                                                                                                                            |
| -------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_API_BASE_URL`                     | `http://localhost:11434/v1`      | API base URL                                                                                                                                                                           |
| `LLM_API_KEY`                          | _(empty)_                        | Bearer token if required                                                                                                                                                               |
| `LLM_MODEL`                            | `dolphin-llama3`                 | Model name                                                                                                                                                                             |
| `LLM_TEMPERATURE`                      | `0.95`                           | Sampling temperature (higher = more variation)                                                                                                                                         |
| `LLM_ENABLED`                          | `true`                           | Set `false` for template-only mode                                                                                                                                                     |
| `ALLOW_TEMPLATE_FALLBACK`              | `true`                           | Fall back if LLM is unreachable                                                                                                                                                        |
| `PROMPT_API_TOKEN`                     | _(empty)_                        | Optional API bearer token for non-browser clients                                                                                                                                      |
| `PROMPT_NSFW_GENERATOR_ENABLED`        | `false`                          | Unlock Adult generator and Roleplay Sultry / Explicit / Raunchy on the server                                                                                                          |
| `NEXT_PUBLIC_PROMPT_NSFW_GENERATOR_ENABLED` | `false`                     | Same lockout for nav/UI (rebuild required). `next.config` copies the server flag when this is unset. Desktop installers bake both flags on.                                             |
| `PROMPT_DESKTOP` / `NEXT_PUBLIC_PROMPT_DESKTOP` | `false`                 | Set by the Tauri shell / desktop Next build. First launch opens Settings → ComfyUI connection.                                                                                         |
| `LLM_VISION_MODEL`                     | _(empty)_                        | Vision-capable model for Image → Prompt, Refine critique, gallery tags. Falls back to `LLM_MODEL` (text-only will fail vision tools)                                                   |
| `LLM_EMBED_MODEL`                      | _(empty)_                        | Optional embedding model for semantic search (`OLLAMA_EMBED_MODEL` also accepted). Settings → LLM can override per session                                                             |
| `PROMPT_ENGINE`                        | `comfyui`                        | `comfyui` (default), `diffusers` (stills only), `fal`, `replicate`, `openai`, `gemini`, `grok`, or `runway`. Fal/Replicate/Grok/Gemini/Runway queue clips; ChatGPT and Diffusers stay stills. |
| `FAL_KEY`                              | _(empty)_                        | Fal API key when Settings → Inference engine is Fal (`FAL_API_KEY` also accepted). Browser Settings key overrides per request.                                                         |
| `FAL_MODEL`                            | `fal-ai/flux/schnell`            | Default Fal txt2img model id                                                                                                                                                           |
| `REPLICATE_API_TOKEN`                  | _(empty)_                        | Replicate token when Settings → Inference engine is Replicate (`REPLICATE_API_KEY` also accepted).                                                                                     |
| `REPLICATE_MODEL`                      | `black-forest-labs/flux-schnell` | Default Replicate txt2img model id                                                                                                                                                     |
| `OPENAI_API_KEY`                       | _(empty)_                        | OpenAI key when Settings → Inference engine is ChatGPT / OpenAI Images.                                                                                                                |
| `OPENAI_MODEL`                         | `gpt-image-2`                    | Default OpenAI image model                                                                                                                                                             |
| `GEMINI_API_KEY`                       | _(empty)_                        | Gemini key when Settings → Inference engine is Google Gemini (`GOOGLE_API_KEY` also accepted).                                                                                         |
| `GEMINI_MODEL`                         | `gemini-3.1-flash-image`         | Default Gemini image model                                                                                                                                                             |
| `XAI_API_KEY`                          | _(empty)_                        | xAI key when Settings → Inference engine is Grok (`GROK_API_KEY` also accepted).                                                                                                       |
| `GROK_MODEL`                           | `grok-imagine-image-2.0`         | Default Grok Imagine model                                                                                                                                                             |
| `RUNWAY_API_KEY`                       | _(empty)_                        | Runway key when Settings → Inference engine is Runway (`RUNWAYML_API_SECRET` also accepted).                                                                                           |
| `RUNWAY_MODEL`                         | `gen4_image`                     | Default Runway Gen-4 image model                                                                                                                                                       |
| `PROMPT_API_URL`                       | `http://127.0.0.1:47832`         | Public origin for invite/reset links, email footers, and the server scheduled-batch runner                                                                                             |
| `PROMPT_AUTH_ENABLED`                  | `false`                          | Enable login and feature access control                                                                                                                                                |
| `PROMPT_ADMIN_USERNAME`                | `admin`                          | Default admin username (seeded on first enable)                                                                                                                                        |
| `PROMPT_ADMIN_PASSWORD`                | `admin`                          | Default admin password (change in production)                                                                                                                                          |
| `PROMPT_SESSION_SECRET`                | _(falls back to API token)_      | HMAC secret for session cookies                                                                                                                                                        |
| `PROMPT_AUTH_DIR`                      | _(uses `PROMPT_DATA_DIR/auth`)_  | Legacy JSON import directory (`users.json`, `groups.json`, analytics). Live auth now lives in `studio.sqlite`.                                                                         |
| `PROMPT_DATA_DIR`                      | _(empty)_                        | Server SQLite root (`studio.sqlite`) for `/api/storage`, auth, collab rooms, SMTP overlay, queue-export overlay, and `{PROMPT_DATA_DIR}/plugins` server plugin registry |
| `PROMPT_PLUGIN_HMAC_SECRET`            | _(empty)_                        | When set, `POST /api/plugins/server` installs must send `X-Prompt-Plugin-Signature` (hex HMAC-SHA256 of the raw body / ZIP bytes) |
| `COLLAB_REDIS_URL`                     | _(empty)_                        | Optional Redis URL for multi-node collab SSE (requires `ioredis`; falls back to SQLite/memory when unset)                                                                              |
| `SERVER_USER_MAINTENANCE`              | `false`                          | Enable `/api/maintenance/run` for per-user scheduled campaigns and export snapshots                                                                                                    |
| `SERVER_USER_MAINTENANCE_INTERVAL_MIN` | `15`                             | When `SERVER_USER_MAINTENANCE=true`, run maintenance on this interval (minutes)                                                                                                        |
| `SERVER_USER_MAINTENANCE_EXPORT_KEEP`  | `20`                             | Snapshot files kept per user under `{PROMPT_DATA_DIR}/users/<id>/exports/`; oldest are deleted past this count after each export. `0` disables pruning                                 |
| `API_RATE_LIMIT_WINDOW_MS`             | `60000`                          | Rate limit window (ms) for API proxy                                                                                                                                                   |
| `API_RATE_LIMIT_MAX`                   | `120`                            | Default max requests per window; overridable per user/group in Settings → Users                                                                                                        |
| `COMFYUI_API_URL`                      | `http://127.0.0.1:8188`          | Default ComfyUI base URL                                                                                                                                                               |
| `COMFYUI_ROOT`                         | _(empty)_                        | Absolute path to the ComfyUI install (same machine). Enables **Settings → ComfyUI → Model assets** curated weight downloads (image, video, audio, 3D mesh) into `models/checkpoints`, `diffusion_models`, `vae`, `text_encoders`, etc. |
| `HF_TOKEN`                             | _(empty)_                        | Optional Hugging Face token for curated downloads (also accepts `HUGGING_FACE_HUB_TOKEN`)                                                                                              |
| `CIVITAI_API_TOKEN`                    | _(empty)_                        | Optional Civitai token for gated LoRA downloads from **Settings → ComfyUI → LoRA library**                                                                                             |
| `TRAINER_URL`                          | _(empty)_                        | Escape hatch: when set, `POST /api/lora-train` start POSTs the job payload (including `datasetPath`) to this webhook instead of spawning a process                                    |
| `TRAINER_COMMAND`                      | _(empty)_                        | Escape hatch: argv spawned without a shell when `TRAINER_URL` is unset (dataset/output/trigger appended). Wins over first-party kohya templates                                         |
| `TRAINER_KOHYA_SCRIPT`                 | _(empty)_                        | Path to sd-scripts `train_network.py`. When URL/command are unset, start builds a first-party kohya argv (rank/steps/resolution/base) and spawns `TRAINER_PYTHON` / `python3`        |
| `TRAINER_PYTHON`                       | `python3`                        | Interpreter for `TRAINER_KOHYA_SCRIPT` when the script ends in `.py` (`PYTHON` is also accepted)                                                                                      |
| `COMFYUI_ALLOW_CLIENT_URL`             | `true`                           | Allow clients to override ComfyUI URL                                                                                                                                                  |
| `COMFYUI_ALLOWED_HOSTS`                | _(empty)_                        | Optional comma-separated ComfyUI host allowlist. Empty = any host (still blocks metadata). Settings extras cannot change this                                                          |
| `COMFYUI_POOL`                         | _(empty)_                        | Comma-separated ComfyUI URLs merged with Settings extras at queue time. Copy a snippet from Settings → ComfyUI cluster after Test                                                      |
| `COMFYUI_QUEUE_EXPORT_DIR`             | _(empty)_                        | Write JSON sidecars after successful queue. Settings → Automation can overlay a directory when this env is unset                                                                       |
| `WEBHOOK_ALLOW_PRIVATE`                | `false`                          | Allow webhook POSTs to private/LAN URLs                                                                                                                                                |
| `PROMPT_EMAIL_ENABLED`                 | auto                             | Set `true` to force email on when SMTP is configured                                                                                                                                   |
| `PROMPT_SMTP_HOST`                     | _(empty)_                        | SMTP server hostname                                                                                                                                                                   |
| `PROMPT_SMTP_PORT`                     | `587`                            | SMTP port                                                                                                                                                                              |
| `PROMPT_SMTP_SECURE`                   | `false`                          | Use TLS directly (typical for port 465)                                                                                                                                                |
| `PROMPT_SMTP_USER`                     | _(empty)_                        | SMTP auth username                                                                                                                                                                     |
| `PROMPT_SMTP_PASS`                     | _(empty)_                        | SMTP auth password                                                                                                                                                                     |
| `PROMPT_EMAIL_FROM`                    | _(empty)_                        | From header, e.g. `Prompt Studio <noreply@example.com>`                                                                                                                                |
| `PROMPT_ADMIN_EMAIL`                   | _(empty)_                        | Fallback recipient for server batches when users have no email                                                                                                                         |
| `PROMPT_EMAIL_NOTIFY_BATCH`            | `true`                           | Send email when scheduled batches/campaigns finish                                                                                                                                     |
| `PROMPT_EMAIL_NOTIFY_PASSWORD`         | `true`                           | Send email when a password is changed                                                                                                                                                  |
| `SERVER_SCHEDULED_BATCH`               | `false`                          | Headless scheduled batch (needs `PROMPT_DATA_DIR`). Browser scheduled batch on Automation is separate                                                                                  |
| `SERVER_SCHEDULED_BATCH_INTERVAL_MIN`  | `60`                             | Minutes between headless batch runs                                                                                                                                                    |
| `SERVER_SCHEDULED_BATCH_TARGET`        | `random-scene`                   | `random-scene` or `topics`                                                                                                                                                             |
| `SERVER_SCHEDULED_BATCH_COUNT`         | `3`                              | Prompts per headless run                                                                                                                                                               |
| `SERVER_SCHEDULED_BATCH_QUEUE`         | `false`                          | Queue headless results to ComfyUI                                                                                                                                                      |

**Settings overlays:** SMTP (`GET`/`POST /api/settings/email`) and queue-export dir (`/api/settings/queue-export`) persist in SQLite when `PROMPT_DATA_DIR` is set. Without it, SMTP is kept in memory until restart. Env values remain the fallback. Passwords are never returned to the browser.

**Invite and password reset:** With auth and SMTP enabled, admins send `POST /api/auth/invite` from Settings → Users. Users request `POST /api/email/forgot-password` and complete `POST /api/auth/reset-password`. Links are `{PROMPT_API_URL}/login?reset=…` and expire in **1 hour**. Tokens live in SQLite (`password_reset_tokens`).

**Queue interrupt:** `POST /api/comfyui/interrupt` forwards an interrupt to ComfyUI (also available on the Queue page).

**ComfyUI restart:** `POST /api/comfyui/restart` asks ComfyUI-Manager to reboot (`/api/manager/reboot` or `/manager/reboot`). Vanilla ComfyUI has no restart API — without Manager the route returns HTTP 501. Also on Queue and Settings → Connection / LoRA library.

**LoRA search:** `GET /api/comfyui/loras/search?q=…` queries Civitai server-side. `POST /api/comfyui/loras/download` with `{ versionId }` writes into `COMFYUI_ROOT/models/loras`. The browser never supplies download URLs.

**LoRA train (kohya / sd-scripts):** Admin `GET`/`POST /api/lora-train` owns the loop. Cast **Export → Train** (and Gallery dataset export) can write image+caption pairs under `{PROMPT_DATA_DIR}/lora-datasets/…` via `action=export-dataset`, then `action=start` always accepts `datasetPath`. Job records persist in SQLite (`kv` key `lora-train-jobs`) so Settings polling survives restart. Priority: `TRAINER_URL` → `TRAINER_COMMAND` → first-party kohya template (`TRAINER_KOHYA_SCRIPT` + Settings template/rank/steps/resolution/base) → manual job. Stdout progress is parsed from kohya/tqdm lines. On complete, Studio copies `.safetensors` into `COMFYUI_ROOT/models/loras`, registers a library entry (client persists), and can pin + auto-queue validation from prefs.

**Second GPU probe:** `POST /api/comfyui/probe` with `{ "url": "http://…" }`. Fetches the host only after allowlist checks. An allowlist miss returns HTTP 400 with `code: "allowlist"` and does not contact the host.

**Webhooks → email:** Outbound webhooks fire on job completion/error. When signed in with batch email notifications enabled, the gallery client also batches completion emails via `POST /api/email/jobs-completed` (debounced ~8s). Server scheduled batches use `POST /api/email/batch-completed`.

### Ollama (local, uncensored)

```bash
ollama pull dolphin-llama3
```

```env
LLM_API_BASE_URL=http://localhost:11434/v1
LLM_MODEL=dolphin-llama3
```
