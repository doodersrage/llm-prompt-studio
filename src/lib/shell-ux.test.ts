import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetBrowserStorageCache } from "./browser-storage";
import { loadRecentDestinations, pushRecentDestination } from "./recent-destinations";
import { isStudioTabId, studioTabHref, STUDIO_TABS, studioTabsForWorkspaceMode } from "./studio-nav";
import { loadUiDensity, saveUiDensity } from "./density-settings";
import { loadWorkspaceMode, saveWorkspaceMode } from "./workspace-mode";
import {
  dismissAppToast,
  getAppToasts,
  pushAppToast,
  rememberToastPreference,
  toastBulkQueueSummary,
  toastQueueOutcome,
} from "./app-toast";
import {
  dismissSystemTrayMessage,
  getSystemTrayMessages,
} from "./system-tray-messages";
import { loadToolContext, saveToolContext } from "./tool-context-memory";
import { resetUiChrome } from "./reset-ui-chrome";
import { loadNavFavorites } from "./nav-favorites";
import {
  loadLastToolRoute,
  resolveLandingRoute,
  saveLastToolRoute,
} from "./last-tool-route";
import {
  loadLastToolDraft,
  rememberToolDraft,
} from "./tool-draft-memory";
import { rememberDraftFields } from "./remember-draft-fields";
import { resolveGenerateEmptyCta } from "./empty-cta";
import { isTransientProgressStatus, toneForStatusText } from "./status-progress";
import { saveNavFavorites } from "./nav-favorites";

function withMockLocalStorage(run: () => void): void {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const dataset: Record<string, string> = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      dispatchEvent: () => true,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset },
    },
  });
  try {
    run();
  } finally {
    if (originalWindow === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
    if (originalDocument === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  }
}

describe("recent destinations", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("keeps the five most recent unique hrefs", () => {
    withMockLocalStorage(() => {
      for (let i = 0; i < 7; i += 1) {
        pushRecentDestination({ href: `/p${i}`, label: `Page ${i}` });
      }
      pushRecentDestination({ href: "/p3", label: "Page 3 again" });
      const recent = loadRecentDestinations();
      assert.equal(recent.length, 5);
      assert.equal(recent[0]?.href, "/p3");
      assert.equal(recent[0]?.label, "Page 3 again");
    });
  });
});

describe("studio nav", () => {
  it("validates tabs and builds hrefs", () => {
    assert.equal(isStudioTabId("history"), true);
    assert.equal(isStudioTabId("nope"), false);
    assert.equal(studioTabHref("history"), "/studio");
    assert.equal(studioTabHref("analytics"), "/studio?tab=analytics");
    assert.ok(STUDIO_TABS.length >= 10);
  });

  it("slims Studio tabs in Simple workspace", () => {
    const simple = studioTabsForWorkspaceMode("simple");
    assert.ok(
      simple.every((tab) =>
        ["history", "compare", "templates", "presets", "analytics"].includes(tab.id),
      ),
    );
    assert.equal(studioTabsForWorkspaceMode("full").length, STUDIO_TABS.length);
  });
});

describe("ui density", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("persists compact density", () => {
    withMockLocalStorage(() => {
      assert.equal(loadUiDensity(), "comfortable");
      saveUiDensity("compact");
      assert.equal(loadUiDensity(), "compact");
      assert.equal(document.documentElement.dataset.density, "compact");
    });
  });
});

describe("app toast", () => {
  beforeEach(() => {
    withMockLocalStorage(() => {
      rememberToastPreference(true);
      while (getAppToasts().length) {
        dismissAppToast(getAppToasts()[0]!.id);
      }
      while (getSystemTrayMessages().length) {
        dismissSystemTrayMessage(getSystemTrayMessages()[0]!.id);
      }
    });
  });

  it("queues and dismisses toasts", () => {
    withMockLocalStorage(() => {
      rememberToastPreference(true);
      const id = pushAppToast({ text: "Queued", tone: "info", ttlMs: 0 });
      assert.ok(id);
      assert.equal(getAppToasts()[0]?.text, "Queued");
      dismissAppToast(id!);
      assert.equal(getAppToasts().length, 0);
    });
  });

  it("toastQueueOutcome uses danger for failures", () => {
    withMockLocalStorage(() => {
      rememberToastPreference(true);
      while (getSystemTrayMessages().length) {
        dismissSystemTrayMessage(getSystemTrayMessages()[0]!.id);
      }
      toastQueueOutcome({ ok: false, text: "ComfyUI queue failed." });
      assert.equal(getSystemTrayMessages()[0]?.tone, "danger");
    });
  });
});

describe("tool context memory", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("stores per-tool model and workflow", () => {
    withMockLocalStorage(() => {
      saveToolContext("generate", {
        model: "qwen-image-2512",
        selectedWorkflowFileId: "wf-1",
      });
      assert.deepEqual(loadToolContext("generate"), {
        model: "qwen-image-2512",
        selectedWorkflowFileId: "wf-1",
      });
      assert.equal(loadToolContext("character"), undefined);
    });
  });
});

describe("last tool route", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("remembers allowed routes and rejects login", () => {
    withMockLocalStorage(() => {
      saveLastToolRoute("/gallery");
      assert.equal(loadLastToolRoute(), "/gallery");
      saveLastToolRoute("/login");
      assert.equal(loadLastToolRoute(), "/gallery");
    });
  });

  it("feature-guards remembered landing routes", () => {
    assert.equal(
      resolveLandingRoute({
        explicitNext: "/gallery",
        remembered: "/studio",
        allowedFeatures: ["gallery", "profile"],
      }),
      "/gallery",
    );
    assert.equal(
      resolveLandingRoute({
        explicitNext: null,
        remembered: "/studio",
        allowedFeatures: ["gallery", "profile"],
      }),
      "/gallery",
    );
    assert.equal(
      resolveLandingRoute({
        explicitNext: "/login",
        remembered: null,
        allowedFeatures: "all",
      }),
      "/dashboard",
    );
  });
});

describe("tool draft memory", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("remembers the latest draft for resume", () => {
    withMockLocalStorage(() => {
      rememberToolDraft({
        toolKey: "generate",
        label: "Generate",
        href: "/",
        text: "neon alley rain",
      });
      const draft = loadLastToolDraft();
      assert.equal(draft?.toolKey, "generate");
      assert.match(draft?.preview ?? "", /neon alley/);
    });
  });

  it("joins multi-field drafts for editor resume", () => {
    withMockLocalStorage(() => {
      rememberDraftFields({
        toolKey: "prompt-editor",
        label: "Prompt Editor",
        href: "/prompt",
        fields: ["a woman in rain", "city night", "blurry"],
      });
      const draft = loadLastToolDraft();
      assert.equal(draft?.href, "/prompt");
      assert.match(draft?.preview ?? "", /woman in rain/);
    });
  });
});

describe("empty cta pins", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("prefers a pinned scene tool over Generate", () => {
    withMockLocalStorage(() => {
      saveNavFavorites(["/character"]);
      assert.deepEqual(resolveGenerateEmptyCta(), {
        label: "Open Character",
        href: "/character",
      });
    });
  });
});

describe("status progress", () => {
  it("detects bulk progress lines", () => {
    assert.equal(isTransientProgressStatus("Upscaling 2/12…"), true);
    assert.equal(isTransientProgressStatus("Bulk upscale finished · 2 queued"), false);
    assert.equal(toneForStatusText("Re-queueing 1/3…"), "neutral");
    assert.equal(toneForStatusText("Bulk re-queue finished · 2 queued · 1 failed"), "danger");
  });
});

describe("bulk queue toast", () => {
  beforeEach(() => {
    withMockLocalStorage(() => {
      resetBrowserStorageCache();
      rememberToastPreference(true);
      while (getSystemTrayMessages().length) {
        dismissSystemTrayMessage(getSystemTrayMessages()[0]!.id);
      }
    });
  });

  it("summarizes bulk results in one tray message", () => {
    withMockLocalStorage(() => {
      rememberToastPreference(true);
      assert.ok(
        toastBulkQueueSummary({
          label: "Bulk upscale finished",
          queued: 2,
          failed: 1,
          skipped: 1,
        }),
      );
      assert.equal(getSystemTrayMessages().length, 1);
      assert.match(getSystemTrayMessages()[0]!.text, /Bulk upscale finished/);
      assert.equal(getSystemTrayMessages()[0]!.tone, "danger");
    });
  });
});

describe("mute toasts", () => {
  beforeEach(() => {
    withMockLocalStorage(() => {
      resetBrowserStorageCache();
      rememberToastPreference(true);
      while (getAppToasts().length) {
        dismissAppToast(getAppToasts()[0]!.id);
      }
      while (getSystemTrayMessages().length) {
        dismissSystemTrayMessage(getSystemTrayMessages()[0]!.id);
      }
    });
  });

  it("skips push when notifications are disabled", () => {
    withMockLocalStorage(() => {
      rememberToastPreference(false);
      assert.equal(pushAppToast({ text: "Should not show", ttlMs: 0 }), null);
      assert.equal(getAppToasts().length, 0);
      assert.equal(toastQueueOutcome({ ok: true, text: "Also hidden", ttlMs: 0 }), null);
      assert.equal(getSystemTrayMessages().length, 0);
      rememberToastPreference(true);
      assert.ok(pushAppToast({ text: "Visible", ttlMs: 0 }));
    });
  });
});

describe("reset ui chrome", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("clears favorites, drafts, routes, and resets density", () => {
    withMockLocalStorage(() => {
      saveToolContext("generate", { model: "qwen-image-2512" });
      saveUiDensity("compact");
      saveWorkspaceMode("simple");
      saveLastToolRoute("/gallery");
      rememberToolDraft({
        toolKey: "generate",
        label: "Generate",
        href: "/",
        text: "neon alley rain",
      });
      resetUiChrome();
      assert.deepEqual(loadNavFavorites(), []);
      assert.equal(loadUiDensity(), "comfortable");
      assert.equal(loadWorkspaceMode(), "play");
      assert.equal(loadToolContext("generate"), undefined);
      assert.equal(loadLastToolRoute(), null);
      assert.equal(loadLastToolDraft(), null);
    });
  });
});

describe("project links", () => {
  it("builds a GitHub new-issue URL with the current page", async () => {
    const { githubBugReportUrl, GITHUB_REPO_URL } = await import("./project-links");
    const href = githubBugReportUrl({ pathname: "/roleplay" });
    assert.equal(href.startsWith(`${GITHUB_REPO_URL}/issues/new?`), true);
    const parsed = new URL(href);
    assert.match(parsed.searchParams.get("body") ?? "", /\/roleplay/);
    assert.match(parsed.searchParams.get("body") ?? "", /What happened/);
  });
});
