import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetBrowserStorageCache } from "./browser-storage";
import { APP_NAV_GROUPS, flattenAppNavLinks } from "./app-nav-catalog";
import {
  SIMPLE_NAV_HREFS,
  defaultExpandedNavGroups,
  hasChosenWorkspaceMode,
  isLeanWorkspaceMode,
  isRoleplayFocusNavHref,
  isRoleplayFocusPath,
  loadWorkspaceMode,
  navGroupsForPath,
  navGroupsForWorkspaceMode,
  normalizeWorkspaceMode,
  saveWorkspaceMode,
  workspaceShowsAdvancedControls,
} from "./workspace-mode";

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

describe("workspace-mode", () => {
  beforeEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });
  afterEach(() => {
    withMockLocalStorage(() => resetBrowserStorageCache());
  });

  it("normalizes unknown modes to play", () => {
    assert.equal(normalizeWorkspaceMode("nope"), "play");
    assert.equal(normalizeWorkspaceMode("simple"), "simple");
    assert.equal(normalizeWorkspaceMode("play"), "play");
  });

  it("persists workspace mode and marks chosen", () => {
    withMockLocalStorage(() => {
      assert.equal(hasChosenWorkspaceMode(), false);
      saveWorkspaceMode("simple");
      assert.equal(loadWorkspaceMode(), "simple");
      assert.equal(hasChosenWorkspaceMode(), true);
      assert.equal(document.documentElement.dataset.workspace, "simple");
    });
  });

  it("builds Essentials + More for simple mode", () => {
    const groups = navGroupsForWorkspaceMode("simple", APP_NAV_GROUPS);
    assert.equal(groups[0]?.label, "Essentials");
    assert.ok(groups[0]!.links.length >= 6);
    for (const href of SIMPLE_NAV_HREFS) {
      assert.ok(
        groups[0]!.links.some((link) => link.href === href),
        `missing essential ${href}`,
      );
    }
    assert.ok(groups[0]!.links.some((link) => link.href === "/dashboard"));
    assert.equal(
      groups[0]!.links.some((link) => link.href === "/studio"),
      false,
      "Studio belongs under More in Simple",
    );
    assert.equal(groups[1]?.label, "More tools");
    assert.ok((groups[1]?.links.length ?? 0) > 5);
    assert.ok(
      groups[1]!.links.some((link) => link.href === "/studio"),
      "Studio should appear in More tools",
    );
    const moreHrefs = groups[1]!.links.map((link) => link.href);
    assert.ok(
      moreHrefs.indexOf("/studio") < moreHrefs.indexOf("/negative") ||
        !moreHrefs.includes("/negative"),
      "preferred More order should surface Studio early",
    );
    const flatCount = flattenAppNavLinks(groups).length;
    assert.equal(flatCount, flattenAppNavLinks(APP_NAV_GROUPS).length);
  });

  it("keeps Edit / Media / Library / Extras structure for studio and full", () => {
    for (const mode of ["studio", "full"] as const) {
      const groups = navGroupsForWorkspaceMode(mode, APP_NAV_GROUPS);
      const labels = groups.map((group) => group.label);
      assert.ok(labels.includes("Edit"));
      assert.ok(labels.includes("Media"));
      assert.ok(labels.includes("Library"));
      assert.ok(labels.includes("Extras"));
      assert.equal(labels.includes("Tools"), false);
    }
  });

  it("defaults Media and Extras collapsed in studio and expands all in full", () => {
    const studio = defaultExpandedNavGroups("studio", APP_NAV_GROUPS);
    assert.equal(studio.includes("Media"), false);
    assert.equal(studio.includes("Extras"), false);
    assert.ok(studio.includes("Edit"));
    const full = defaultExpandedNavGroups("full", APP_NAV_GROUPS);
    assert.deepEqual(
      full,
      APP_NAV_GROUPS.map((group) => group.label),
    );
    assert.deepEqual(
      defaultExpandedNavGroups("simple", [
        { label: "Essentials", links: [] },
        { label: "More tools", links: [] },
      ]),
      ["Essentials"],
    );
  });

  it("hides advanced controls in Simple and Play", () => {
    assert.equal(workspaceShowsAdvancedControls("simple"), false);
    assert.equal(workspaceShowsAdvancedControls("play"), false);
    assert.equal(workspaceShowsAdvancedControls("studio"), true);
    assert.equal(workspaceShowsAdvancedControls("full"), true);
    assert.equal(isLeanWorkspaceMode("play"), true);
  });

  it("treats Cast and Roleplay routes as Play focus, not Generate Character", () => {
    assert.equal(isRoleplayFocusPath("/roleplay"), true);
    assert.equal(isRoleplayFocusPath("/fitting"), true);
    assert.equal(isRoleplayFocusPath("/day"), true);
    assert.equal(isRoleplayFocusPath("/moodboard"), true);
    assert.equal(isRoleplayFocusPath("/play"), true);
    assert.equal(isRoleplayFocusPath("/characters"), true);
    assert.equal(isRoleplayFocusPath("/characters/kai"), true);
    assert.equal(isRoleplayFocusPath("/character"), false);
    assert.equal(isRoleplayFocusPath("/gallery"), false);
    assert.equal(isRoleplayFocusPath("/"), false);
    assert.equal(isRoleplayFocusPath("/m/play"), false);
  });

  it("slims Cast/Roleplay chrome to Play destinations plus All tools", () => {
    for (const mode of ["simple", "studio", "full"] as const) {
      for (const path of ["/roleplay", "/fitting", "/day", "/characters", "/characters/kai"]) {
        const groups = navGroupsForPath(mode, path, APP_NAV_GROUPS);
        assert.deepEqual(
          groups.map((group) => group.label),
          ["Play"],
        );
        const hrefs = groups[0]!.links.map((link) => link.href);
        assert.deepEqual(hrefs, [
          "/characters",
          "/play",
          "/moodboard",
          "/fitting",
          "/day",
          "/roleplay",
          "/gallery",
          "/queue",
          "/",
        ]);
        assert.equal(
          groups[0]!.links.find((link) => link.href === "/")?.label,
          "All tools",
        );
      }
    }
  });

  it("Roleplay workspace mode is a kiosk catalog without Audio, Mesh, or Plugins", () => {
    const groups = navGroupsForWorkspaceMode("play", APP_NAV_GROUPS);
    assert.deepEqual(
      groups.map((group) => group.label),
      ["Play"],
    );
    const hrefs = groups[0]!.links.map((link) => link.href);
    assert.deepEqual(hrefs, [
      "/characters",
      "/play",
      "/moodboard",
      "/fitting",
      "/day",
      "/roleplay",
      "/gallery",
      "/queue",
      "/",
    ]);
    assert.equal(hrefs.includes("/audio"), false);
    assert.equal(hrefs.includes("/mesh"), false);
    assert.equal(hrefs.includes("/plugins"), false);
    const generate = navGroupsForPath("play", "/", APP_NAV_GROUPS);
    assert.equal(generate[0]?.label, "Play");
  });

  it("leaves Generate and other studio routes on the full workspace catalog", () => {
    const focused = navGroupsForPath("simple", "/roleplay", APP_NAV_GROUPS);
    const generate = navGroupsForPath("simple", "/", APP_NAV_GROUPS);
    assert.equal(focused[0]?.label, "Play");
    assert.equal(generate[0]?.label, "Essentials");
    assert.ok(generate[0]!.links.some((link) => link.href === "/roleplay"));
    const studio = navGroupsForPath("studio", "/video", APP_NAV_GROUPS);
    assert.ok(studio.some((group) => group.label === "Edit"));
  });

  it("expands Roleplay by default and allows footer Settings/Profile hrefs", () => {
    const play = navGroupsForPath("studio", "/roleplay", APP_NAV_GROUPS);
    assert.deepEqual(defaultExpandedNavGroups("studio", play), ["Play"]);
    assert.equal(isRoleplayFocusNavHref("/characters"), true);
    assert.equal(isRoleplayFocusNavHref("/settings"), true);
    assert.equal(isRoleplayFocusNavHref("/profile"), true);
    assert.equal(isRoleplayFocusNavHref("/"), true);
    assert.equal(isRoleplayFocusNavHref("/video"), false);
    assert.equal(isRoleplayFocusNavHref("/character"), false);
  });
});
