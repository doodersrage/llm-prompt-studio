import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerEnvField, ServerEnvGroup, ServerEnvSummary } from "./server-env-summary";

const ENV_KEYS = [
  "LLM_ENABLED",
  "LLM_API_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_VISION_MODEL",
  "LLM_TEMPERATURE",
  "LLM_EMBED_MODEL",
  "OLLAMA_EMBED_MODEL",
  "ALLOW_TEMPLATE_FALLBACK",
  "COMFYUI_API_URL",
  "DIFFUSERS_API_URL",
  "PROMPT_ENGINE",
  "DIFFUSERS_AUTOSTART",
  "FAL_KEY",
  "FAL_API_KEY",
  "REPLICATE_API_TOKEN",
  "REPLICATE_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "RUNWAY_API_KEY",
  "RUNWAYML_API_SECRET",
  "COMFYUI_ROOT",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "CIVITAI_API_TOKEN",
  "COMFYUI_ALLOW_CLIENT_URL",
  "COMFYUI_ALLOWED_HOSTS",
  "COMFYUI_POOL",
  "COMFYUI_WORKFLOW_PATH",
  "COMFYUI_WORKFLOW_DIR",
  "COMFYUI_WORKFLOW_PATHS",
  "COMFYUI_WORKFLOW_JSON",
  "COMFYUI_POSITIVE_NODE_ID",
  "COMFYUI_NEGATIVE_NODE_ID",
  "COMFYUI_QUEUE_EXPORT_DIR",
  "COMFYUI_POSITIVE_TOKEN",
  "COMFYUI_NEGATIVE_TOKEN",
  "PROMPT_NSFW_GENERATOR_ENABLED",
  "PROMPT_API_TOKEN",
  "PROMPT_AUTH_ENABLED",
  "PROMPT_SESSION_SECRET",
  "PROMPT_ADMIN_PASSWORD",
  "PROMPT_ADMIN_USERNAME",
  "API_RATE_LIMIT_MAX",
  "API_RATE_LIMIT_WINDOW_SEC",
  "WEBHOOK_ALLOW_PRIVATE",
  "PROMPT_API_URL",
  "PROMPT_DATA_DIR",
  "PROMPT_PLUGIN_HMAC_SECRET",
  "PROMPT_DESKTOP",
  "PROMPT_EMAIL_ENABLED",
  "PROMPT_SMTP_HOST",
  "PROMPT_SMTP_PORT",
  "PROMPT_SMTP_SECURE",
  "PROMPT_SMTP_USER",
  "PROMPT_SMTP_PASS",
  "PROMPT_EMAIL_FROM",
  "PROMPT_ADMIN_EMAIL",
  "PROMPT_EMAIL_NOTIFY_BATCH",
  "PROMPT_EMAIL_NOTIFY_PASSWORD",
  "TRAINER_URL",
  "TRAINER_COMMAND",
  "TRAINER_KOHYA_SCRIPT",
  "TRAINER_PYTHON",
  "PYTHON",
  "SERVER_SCHEDULED_BATCH",
  "SERVER_SCHEDULED_BATCH_INTERVAL_MIN",
  "SERVER_SCHEDULED_BATCH_TARGET",
  "SERVER_SCHEDULED_BATCH_COUNT",
  "SERVER_SCHEDULED_BATCH_QUEUE",
  "SERVER_SCHEDULED_BATCH_GENRE",
] as const;

/**
 * Sets/unsets env vars for the duration of `fn`, restoring the previous
 * values (including "was unset") afterwards. Never leaves PROMPT_DATA_DIR
 * set, per module notes: getServerEnvSummary() must stay zero-I/O.
 */
function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  }
}

/** Clears every env var this module reads, so each test starts from a known-blank slate. */
function withCleanEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const blank: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    blank[key] = undefined;
  }
  return withEnv({ ...blank, ...overrides }, fn);
}

function findGroup(summary: ServerEnvSummary, id: ServerEnvGroup["id"]): ServerEnvGroup {
  const group = summary.groups.find(g => g.id === id);
  assert.ok(group, `expected a "${id}" group`);
  return group!;
}

function findField(fields: ServerEnvField[], key: string): ServerEnvField {
  const field = fields.find(f => f.key === key);
  assert.ok(field, `expected a field with key "${key}"`);
  return field!;
}

describe("server-env-summary", async () => {
  const { getServerEnvSummary } = await import("./server-env-summary");

  describe("top-level shape", () => {
    it("returns exactly the six documented groups with non-empty fields", () => {
      withCleanEnv({}, () => {
        const summary = getServerEnvSummary();
        assert.equal(summary.groups.length, 6);
        const ids = summary.groups.map(g => g.id);
        assert.deepEqual(ids, ["llm", "comfyui", "security", "storage", "email", "automation"]);
        for (const group of summary.groups) {
          assert.ok(group.title.length > 0, `group ${group.id} should have a title`);
          assert.ok(
            Array.isArray(group.fields) && group.fields.length > 0,
            `group ${group.id} should have fields`
          );
          for (const field of group.fields) {
            assert.equal(typeof field.key, "string");
            assert.equal(typeof field.label, "string");
            assert.equal(typeof field.value, "string");
            assert.equal(typeof field.configured, "boolean");
          }
        }
      });
    });
  });

  describe("llm group", () => {
    it("reflects LLM_ENABLED true/false via isLlmEnabled()", () => {
      withCleanEnv({ LLM_ENABLED: "false" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_ENABLED");
        assert.equal(field.value, "false");
        assert.equal(field.configured, true);
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_ENABLED");
        assert.equal(field.value, "true");
      });
    });

    it("masks LLM_API_KEY as configured/not set without leaking the value", () => {
      withCleanEnv({ LLM_API_KEY: "sk-super-secret-value" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_API_KEY");
        assert.equal(field.value, "•••• configured");
        assert.equal(field.configured, true);
        assert.ok(!field.value.includes("sk-super-secret-value"));
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_API_KEY");
        assert.equal(field.value, "not set");
        assert.equal(field.configured, false);
      });
    });

    it("passes through LLM_API_BASE_URL and LLM_MODEL", () => {
      withCleanEnv(
        { LLM_API_BASE_URL: "http://example.test:1234/v1", LLM_MODEL: "custom-model" },
        () => {
          const fields = findGroup(getServerEnvSummary(), "llm").fields;
          assert.equal(findField(fields, "LLM_API_BASE_URL").value, "http://example.test:1234/v1");
          assert.equal(findField(fields, "LLM_MODEL").value, "custom-model");
        }
      );
    });

    it("falls back LLM_VISION_MODEL to LLM_MODEL and reports unconfigured when unset", () => {
      withCleanEnv({ LLM_MODEL: "base-model" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_VISION_MODEL");
        assert.equal(field.value, "base-model");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ LLM_MODEL: "base-model", LLM_VISION_MODEL: "vision-model" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_VISION_MODEL");
        assert.equal(field.value, "vision-model");
        assert.equal(field.configured, true);
      });
    });

    it("falls back LLM_EMBED_MODEL to OLLAMA_EMBED_MODEL then to a server default", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_EMBED_MODEL");
        assert.equal(field.value, "server default");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ OLLAMA_EMBED_MODEL: "nomic-embed-text" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        const field = findField(fields, "LLM_EMBED_MODEL");
        assert.equal(field.value, "nomic-embed-text");
        assert.equal(field.configured, true);
      });
      withCleanEnv({ LLM_EMBED_MODEL: "explicit-embed", OLLAMA_EMBED_MODEL: "ignored" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        assert.equal(findField(fields, "LLM_EMBED_MODEL").value, "explicit-embed");
      });
    });

    it("reflects ALLOW_TEMPLATE_FALLBACK via allowTemplateFallback()", () => {
      withCleanEnv({ ALLOW_TEMPLATE_FALLBACK: "false" }, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        assert.equal(findField(fields, "ALLOW_TEMPLATE_FALLBACK").value, "disabled");
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "llm").fields;
        assert.equal(findField(fields, "ALLOW_TEMPLATE_FALLBACK").value, "allowed");
      });
    });
  });

  describe("comfyui group", () => {
    it("defaults DIFFUSERS_API_URL to the loopback default when unset", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "DIFFUSERS_API_URL");
        assert.equal(field.value, "http://127.0.0.1:8190");
        assert.equal(field.configured, false);
      });
    });

    it("reports a configured DIFFUSERS_API_URL verbatim", () => {
      withCleanEnv({ DIFFUSERS_API_URL: "http://diffusers.internal:9000" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "DIFFUSERS_API_URL");
        assert.equal(field.value, "http://diffusers.internal:9000");
        assert.equal(field.configured, true);
      });
    });

    it("defaults PROMPT_ENGINE to comfyui when unset", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        assert.equal(findField(fields, "PROMPT_ENGINE").value, "comfyui");
        assert.equal(findField(fields, "PROMPT_ENGINE").configured, false);
      });
      withCleanEnv({ PROMPT_ENGINE: "diffusers" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        assert.equal(findField(fields, "PROMPT_ENGINE").value, "diffusers");
        assert.equal(findField(fields, "PROMPT_ENGINE").configured, true);
      });
    });

    it("masks each provider API key field independently, without leaking values", () => {
      withCleanEnv(
        {
          FAL_KEY: "fal-secret",
          OPENAI_API_KEY: "oai-secret",
          GEMINI_API_KEY: "gem-secret",
          XAI_API_KEY: "xai-secret",
          RUNWAY_API_KEY: "runway-secret",
        },
        () => {
          const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
          for (const key of ["FAL_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "RUNWAY_API_KEY"]) {
            const field = findField(fields, key);
            assert.equal(field.value, "•••• configured");
            assert.equal(field.configured, true);
          }
        }
      );
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        for (const key of ["FAL_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "RUNWAY_API_KEY"]) {
          const field = findField(fields, key);
          assert.equal(field.value, "not set");
          assert.equal(field.configured, false);
        }
      });
    });

    it("falls back FAL_KEY to FAL_API_KEY, REPLICATE_API_TOKEN to REPLICATE_API_KEY", () => {
      withCleanEnv({ FAL_API_KEY: "fallback-fal" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        assert.equal(findField(fields, "FAL_KEY").configured, true);
      });
      withCleanEnv({ REPLICATE_API_KEY: "fallback-replicate" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        assert.equal(findField(fields, "REPLICATE_API_TOKEN").configured, true);
      });
    });

    it("formats COMFYUI_POOL as a round-robin endpoint count", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_POOL");
        assert.equal(field.value, "not set (single URL only)");
        assert.equal(field.configured, false);
      });
      withCleanEnv(
        { COMFYUI_POOL: "http://a.test:8188,http://b.test:8188,http://c.test:8188" },
        () => {
          const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
          const field = findField(fields, "COMFYUI_POOL");
          assert.equal(field.value, "3 endpoint(s) — round-robin");
          assert.equal(field.configured, true);
        }
      );
      withCleanEnv({ COMFYUI_POOL: "http://a.test:8188,,http://b.test:8188," }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_POOL");
        assert.equal(field.value, "2 endpoint(s) — round-robin");
      });
    });

    it("shows the allowed-hosts placeholder when COMFYUI_ALLOWED_HOSTS is unset", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_ALLOWED_HOSTS");
        assert.equal(field.value, "any (no allowlist)");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ COMFYUI_ALLOWED_HOSTS: "comfy.internal,comfy2.internal" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_ALLOWED_HOSTS");
        assert.equal(field.value, "comfy.internal,comfy2.internal");
        assert.equal(field.configured, true);
      });
    });

    it("reports the resolved ComfyUI base URL via getComfyUiBaseUrl(), falling back gracefully on error", () => {
      withCleanEnv({ COMFYUI_API_URL: "http://comfy.internal:8188" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_API_URL");
        assert.equal(field.value, "http://comfy.internal:8188");
        assert.equal(field.configured, true);
      });
      // An unparsable env URL makes getComfyUiBaseUrl() throw internally; the
      // summary must swallow that and fall back to "not configured" rather
      // than throwing itself.
      withCleanEnv({ COMFYUI_API_URL: "not a valid url" }, () => {
        const summary = getServerEnvSummary();
        const fields = findGroup(summary, "comfyui").fields;
        const field = findField(fields, "COMFYUI_API_URL");
        assert.equal(field.value, "not configured");
        assert.equal(field.configured, false);
      });
    });

    it("reflects COMFYUI_QUEUE_EXPORT_DIR's configured flag via isQueueArtifactExportEnabled()", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_QUEUE_EXPORT_DIR");
        assert.equal(field.value, "not set");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ COMFYUI_QUEUE_EXPORT_DIR: "/tmp/queue-exports" }, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        const field = findField(fields, "COMFYUI_QUEUE_EXPORT_DIR");
        assert.equal(field.value, "/tmp/queue-exports");
        assert.equal(field.configured, true);
      });
    });

    it("defaults the placeholder token fields", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "comfyui").fields;
        assert.equal(findField(fields, "COMFYUI_POSITIVE_TOKEN").value, "default ({{POSITIVE}})");
        assert.equal(findField(fields, "COMFYUI_NEGATIVE_TOKEN").value, "default ({{NEGATIVE}})");
      });
    });
  });

  describe("security group", () => {
    it("reflects the adult-content flag via isNsfwGeneratorEnabledServer()", () => {
      withCleanEnv({ PROMPT_NSFW_GENERATOR_ENABLED: "true" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_NSFW_GENERATOR_ENABLED");
        assert.equal(field.value, "true");
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_NSFW_GENERATOR_ENABLED");
        assert.equal(field.value, "false");
      });
    });

    it("reflects login-required via isAuthExplicitlyEnabled()", () => {
      for (const truthy of ["1", "true", "yes"]) {
        withCleanEnv({ PROMPT_AUTH_ENABLED: truthy }, () => {
          const fields = findGroup(getServerEnvSummary(), "security").fields;
          assert.equal(findField(fields, "PROMPT_AUTH_ENABLED").value, "true");
        });
      }
      withCleanEnv({ PROMPT_AUTH_ENABLED: "nope" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "PROMPT_AUTH_ENABLED").value, "false");
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "PROMPT_AUTH_ENABLED").value, "false");
      });
    });

    it("flags an insecure fallback session secret only when auth is enabled and unset", () => {
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_SESSION_SECRET");
        assert.equal(field.value, "INSECURE - using hardcoded fallback");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true", PROMPT_SESSION_SECRET: "a-real-secret" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_SESSION_SECRET");
        assert.equal(field.value, "configured");
        assert.equal(field.configured, true);
      });
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true", PROMPT_API_TOKEN: "a-real-token" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_SESSION_SECRET");
        assert.equal(field.value, "configured");
        assert.equal(field.configured, true);
      });
      withCleanEnv({}, () => {
        // Auth off entirely - unset secret is not a problem worth flagging.
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_SESSION_SECRET");
        assert.equal(field.value, "not needed (login not required)");
        assert.equal(field.configured, true);
      });
    });

    it("flags default admin credentials only when auth is enabled and the password is unset", () => {
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_ADMIN_PASSWORD");
        assert.equal(field.value, 'INSECURE - "admin" is still on the default password');
        assert.equal(field.configured, false);
      });
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true", PROMPT_ADMIN_USERNAME: "root" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_ADMIN_PASSWORD");
        assert.equal(field.value, 'INSECURE - "root" is still on the default password');
        assert.equal(field.configured, false);
      });
      withCleanEnv({ PROMPT_AUTH_ENABLED: "true", PROMPT_ADMIN_PASSWORD: "a-strong-password" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_ADMIN_PASSWORD");
        assert.equal(field.value, "configured");
        assert.equal(field.configured, true);
      });
      withCleanEnv({}, () => {
        // Auth off entirely - default password is not a problem worth flagging.
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_ADMIN_PASSWORD");
        assert.equal(field.value, "not needed (login not required)");
        assert.equal(field.configured, true);
      });
    });

    it("masks PROMPT_API_TOKEN without leaking the value", () => {
      withCleanEnv({ PROMPT_API_TOKEN: "top-secret-token" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        const field = findField(fields, "PROMPT_API_TOKEN");
        assert.equal(field.value, "•••• configured");
        assert.ok(!field.value.includes("top-secret-token"));
      });
    });

    it("defaults API_RATE_LIMIT_MAX and _WINDOW_SEC when unset", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "API_RATE_LIMIT_MAX").value, "120 (default)");
        assert.equal(findField(fields, "API_RATE_LIMIT_WINDOW_SEC").value, "60 (default)");
      });
      withCleanEnv({ API_RATE_LIMIT_MAX: "500", API_RATE_LIMIT_WINDOW_SEC: "30" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "API_RATE_LIMIT_MAX").value, "500");
        assert.equal(findField(fields, "API_RATE_LIMIT_WINDOW_SEC").value, "30");
      });
    });

    it("only treats WEBHOOK_ALLOW_PRIVATE==='true' as enabled", () => {
      withCleanEnv({ WEBHOOK_ALLOW_PRIVATE: "true" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "WEBHOOK_ALLOW_PRIVATE").value, "true");
      });
      withCleanEnv({ WEBHOOK_ALLOW_PRIVATE: "1" }, () => {
        const fields = findGroup(getServerEnvSummary(), "security").fields;
        assert.equal(findField(fields, "WEBHOOK_ALLOW_PRIVATE").value, "false");
      });
    });
  });

  describe("storage group", () => {
    it("reports PROMPT_DATA_DIR as not set/unconfigured when unset (isServerStorageEnabled())", () => {
      // NOTE: deliberately never set PROMPT_DATA_DIR in this suite. Doing so
      // flips isServerStorageEnabled() to true, which makes getEmailConfig()
      // (called unconditionally by getServerEnvSummary()) read through to
      // real sqlite storage via readStoredEmailConfig() -> readKv() -> a real
      // getStudioDb() open/mkdir. That is real disk I/O this module promises
      // to avoid when PROMPT_DATA_DIR is unset, and it isn't writable/safe in
      // a unit test sandbox. Confirmed via real execution: setting
      // PROMPT_DATA_DIR here throws EACCES trying to mkdir the configured
      // path.
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "storage").fields;
        const field = findField(fields, "PROMPT_DATA_DIR");
        assert.equal(field.value, "not set");
        assert.equal(field.configured, false);
      });
    });

    it("reports PROMPT_PLUGIN_HMAC_SECRET as set/not set without leaking the value", () => {
      withCleanEnv({ PROMPT_PLUGIN_HMAC_SECRET: "hmac-secret-value" }, () => {
        const fields = findGroup(getServerEnvSummary(), "storage").fields;
        const field = findField(fields, "PROMPT_PLUGIN_HMAC_SECRET");
        assert.equal(field.value, "set");
        assert.ok(!field.value.includes("hmac-secret-value"));
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "storage").fields;
        assert.equal(findField(fields, "PROMPT_PLUGIN_HMAC_SECRET").value, "not set");
      });
    });

    it("reflects the desktop shell flag via isDesktopShellServer()", () => {
      withCleanEnv({ PROMPT_DESKTOP: "1" }, () => {
        const fields = findGroup(getServerEnvSummary(), "storage").fields;
        const field = findField(fields, "PROMPT_DESKTOP");
        assert.equal(field.value, "true");
        assert.equal(field.configured, true);
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "storage").fields;
        const field = findField(fields, "PROMPT_DESKTOP");
        assert.equal(field.value, "false");
        assert.equal(field.configured, false);
      });
    });
  });

  describe("email group", () => {
    it("auto-enables when SMTP host and from address are both set (getEmailConfig)", () => {
      withCleanEnv({ PROMPT_SMTP_HOST: "smtp.example.test" }, () => {
        const fields = findGroup(getServerEnvSummary(), "email").fields;
        assert.equal(findField(fields, "PROMPT_EMAIL_ENABLED").value, "true");
        assert.equal(findField(fields, "PROMPT_EMAIL_ENABLED").configured, true);
        assert.equal(findField(fields, "PROMPT_SMTP_HOST").value, "smtp.example.test");
        // No explicit PROMPT_EMAIL_FROM: getEmailConfig() defaults it once a host is set.
        assert.equal(findField(fields, "PROMPT_EMAIL_FROM").value, "Prompt Studio <noreply@localhost>");
      });
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "email").fields;
        assert.equal(findField(fields, "PROMPT_EMAIL_ENABLED").value, "false");
        assert.equal(findField(fields, "PROMPT_EMAIL_ENABLED").configured, false);
        assert.equal(findField(fields, "PROMPT_SMTP_HOST").value, "not set");
      });
    });

    it("reports PROMPT_ADMIN_EMAIL and the notify-on flags (default true unless 'false')", () => {
      withCleanEnv({ PROMPT_ADMIN_EMAIL: "admin@example.test" }, () => {
        const fields = findGroup(getServerEnvSummary(), "email").fields;
        assert.equal(findField(fields, "PROMPT_ADMIN_EMAIL").value, "admin@example.test");
        assert.equal(findField(fields, "PROMPT_EMAIL_NOTIFY_BATCH").value, "true");
        assert.equal(findField(fields, "PROMPT_EMAIL_NOTIFY_PASSWORD").value, "true");
      });
      withCleanEnv(
        { PROMPT_EMAIL_NOTIFY_BATCH: "false", PROMPT_EMAIL_NOTIFY_PASSWORD: "false" },
        () => {
          const fields = findGroup(getServerEnvSummary(), "email").fields;
          assert.equal(findField(fields, "PROMPT_EMAIL_NOTIFY_BATCH").value, "false");
          assert.equal(findField(fields, "PROMPT_EMAIL_NOTIFY_PASSWORD").value, "false");
        }
      );
    });
  });

  describe("automation group", () => {
    it("passes through TRAINER_URL / TRAINER_COMMAND / TRAINER_KOHYA_SCRIPT verbatim when set", () => {
      withCleanEnv(
        {
          TRAINER_URL: "http://trainer.internal/webhook",
          TRAINER_COMMAND: "run-trainer.sh",
          TRAINER_KOHYA_SCRIPT: "/opt/sd-scripts/train_network.py",
        },
        () => {
          const fields = findGroup(getServerEnvSummary(), "automation").fields;
          assert.equal(findField(fields, "TRAINER_URL").value, "http://trainer.internal/webhook");
          assert.equal(findField(fields, "TRAINER_COMMAND").value, "run-trainer.sh");
          assert.equal(
            findField(fields, "TRAINER_KOHYA_SCRIPT").value,
            "/opt/sd-scripts/train_network.py"
          );
        }
      );
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "automation").fields;
        assert.equal(findField(fields, "TRAINER_URL").value, "not set");
        assert.equal(findField(fields, "TRAINER_COMMAND").value, "not set");
        assert.equal(findField(fields, "TRAINER_KOHYA_SCRIPT").value, "not set");
      });
    });

    it("falls back TRAINER_PYTHON to PYTHON, then to a python3 default", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "automation").fields;
        const field = findField(fields, "TRAINER_PYTHON");
        assert.equal(field.value, "python3 (default)");
        assert.equal(field.configured, false);
      });
      withCleanEnv({ PYTHON: "/usr/bin/python3.11" }, () => {
        const fields = findGroup(getServerEnvSummary(), "automation").fields;
        const field = findField(fields, "TRAINER_PYTHON");
        assert.equal(field.value, "/usr/bin/python3.11");
        assert.equal(field.configured, true);
      });
      withCleanEnv({ TRAINER_PYTHON: "/opt/venv/bin/python", PYTHON: "/usr/bin/python3.11" }, () => {
        const fields = findGroup(getServerEnvSummary(), "automation").fields;
        assert.equal(findField(fields, "TRAINER_PYTHON").value, "/opt/venv/bin/python");
      });
    });

    it("reflects SERVER_SCHEDULED_BATCH boolean flags and defaults", () => {
      withCleanEnv({}, () => {
        const fields = findGroup(getServerEnvSummary(), "automation").fields;
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH").value, "false");
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_INTERVAL_MIN").value, "60 (default)");
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_TARGET").value, "random-scene (default)");
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_COUNT").value, "3 (default)");
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_QUEUE").value, "false");
        assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_GENRE").value, "not set");
      });
      withCleanEnv(
        {
          SERVER_SCHEDULED_BATCH: "true",
          SERVER_SCHEDULED_BATCH_INTERVAL_MIN: "15",
          SERVER_SCHEDULED_BATCH_TARGET: "topics",
          SERVER_SCHEDULED_BATCH_COUNT: "10",
          SERVER_SCHEDULED_BATCH_QUEUE: "true",
          SERVER_SCHEDULED_BATCH_GENRE: "cyberpunk",
        },
        () => {
          const fields = findGroup(getServerEnvSummary(), "automation").fields;
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH").value, "true");
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_INTERVAL_MIN").value, "15");
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_TARGET").value, "topics");
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_COUNT").value, "10");
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_QUEUE").value, "true");
          assert.equal(findField(fields, "SERVER_SCHEDULED_BATCH_GENRE").value, "cyberpunk");
        }
      );
    });
  });
});
