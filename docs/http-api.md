# HTTP API

JSON REST API for scripts, ComfyUI nodes, and external integrations. Live catalog: `GET /api`.

All endpoints return **JSON** (`Content-Type: application/json`) and support **CORS** (`Access-Control-Allow-Origin: *`) for use from scripts, ComfyUI custom nodes, or other apps.

### Discovery

```bash
# API catalog: tools, request/response shapes, curl examples
curl -sS http://localhost:47832/api | jq .

# Supported models (47 targets) with limits per detail level
curl -sS http://localhost:47832/api/models | jq .

# Filter by family or fetch one model
curl -sS "http://localhost:47832/api/models?category=flux" | jq .
curl -sS "http://localhost:47832/api/models?id=sdxl" | jq .
```

| Endpoint            | Method | Purpose                                                                      |
| ------------------- | ------ | ---------------------------------------------------------------------------- |
| `/api`              | GET    | API catalog and schema documentation                                         |
| `/api/models`       | GET    | List models (`?category=`, `?id=`)                                           |
| `/api/generate`     | POST   | Keywords → model-ready prompt                                                |
| `/api/format`       | POST   | Existing draft → model-ready prompt                                          |
| `/api/topics`       | POST   | Seed theme (optional) → list of topic ideas                                  |
| `/api/random-scene` | POST   | Random cohesive scene prompt (also available via Generate → Random surprise) |
| `/api/character`    | POST   | Detailed single-person prompt                                                |
| `/api/roleplay`     | POST   | Roleplay bio, scene beats, or still prompt (`action`: bio / scenes / prompt) |
| `/api/background`   | POST   | People-free environment prompt                                               |
| `/api/image-prompt` | POST   | Image upload/base64 → prompt (vision LLM)                                    |
| `/api/compose/transfer-scan` | POST | Multi-image vision → Compose transfer instruction (pose/people recipes) |

Errors use a consistent shape: `{ "error": "message" }` with an appropriate HTTP status (400, 404, 405, 500).

### Format API

```bash
curl -X POST http://localhost:47832/api/format \
  -H "Content-Type: application/json" \
  -d '{"input":"1girl, neon alley, rain, masterpiece","model":"flux-2-klein","detail":"balanced","smartFormat":true}'
```

Set `"smartFormat": false` for instant rules-only cleanup (no LLM).

## Generate API

```bash
curl -X POST http://localhost:47832/api/generate \
  -H "Content-Type: application/json" \
  -d '{"input":"neon alley, rain, black cat","mode":"positive","model":"sdxl","detail":"balanced"}'
```

Response:

```json
{
  "prompt": "...",
  "mode": "positive",
  "provider": "llm",
  "model": "sdxl",
  "comfyNode": "CLIP Text Encode (Prompt)",
  "limits": {
    "maxChars": 520,
    "maxSentences": 3,
    "maxTokens": 380
  }
}
```

Model IDs match the registry in `src/lib/comfy-models/registry.ts`.

## Health, cluster, and operator

Same-origin browser UI does not need `PROMPT_API_TOKEN`. Cross-origin scripts should send `Authorization: Bearer <token>` when that env is set. Admin routes require an admin session cookie when auth is on.

```bash
# LLM + ComfyUI + pool + storage + SMTP configured?
curl -sS http://localhost:47832/api/health | jq '.llm.ok, .comfyui.ok, .email, .storage, .auth'

# Probe a ComfyUI URL (fetches only if the host is allowlisted)
curl -sS -X POST http://localhost:47832/api/comfyui/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"http://127.0.0.1:8189"}'
```

Allowlist miss: HTTP 400 `{ "error": "Host … is not on COMFYUI_ALLOWED_HOSTS…", "code": "allowlist", "hostname": "…" }` — no outbound fetch.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | LLM, ComfyUI, pool, storage, email, auth, `serverEnv` catalog |
| `/api/comfyui/probe` | POST | `{ url }` — health-check one pool member |
| `/api/comfyui/interrupt` | POST | Forward interrupt to ComfyUI |
| `/api/settings/email` | GET, POST | SMTP overlay (admin; never returns password) |
| `/api/settings/queue-export` | GET, POST | Queue sidecar directory overlay (admin) |
| `/api/email/test` | POST | Send a test message (`{ to }` optional; required if auth is off) |
| `/api/email/forgot-password` | POST | `{ username }` or `{ email }` — always generic success |
| `/api/auth/invite` | POST | Admin: create/re-send invite email |
| `/api/auth/reset-password` | POST | `{ token, password }` |
| `/api/storage` | GET, PUT | Namespaced server sync (`PROMPT_DATA_DIR` SQLite) |
| `/api/storage/restore` | GET | Read-only pull of one namespace |
| `/api/storage/export` | POST | Encrypted server export snapshot |
| `/api/lora-train` | GET, POST | Admin LoRA train jobs (SQLite-durable). POST actions: `export-dataset`, `start` (accepts `datasetPath`), `progress`, `complete` |
| `/api/plugins/server` | GET, POST, DELETE | Server plugin registry under `PROMPT_DATA_DIR/plugins` (ZIP/URL install; optional HMAC). Feature `plugins`; admin when auth on |

Operator walkthrough: [operator.md](operator.md). Env names: [configuration.md](configuration.md).

## Auth

```bash
# Session
curl -sS http://localhost:47832/api/auth/session

# Invite (admin cookie)
curl -sS -X POST http://localhost:47832/api/auth/invite \
  -H "Content-Type: application/json" \
  -d '{"username":"alex","email":"alex@example.com","role":"user"}'
```

When `PROMPT_AUTH_ENABLED=true`, most UI routes redirect to `/login`. API feature IDs are listed in `src/lib/auth/features.ts`.

