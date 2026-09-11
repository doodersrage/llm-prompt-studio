import { readBrowserString, writeBrowserString } from './browser-storage';
import {
  APP_NAV_EXTRAS_GROUP_LABEL,
  APP_NAV_GROUPS,
  APP_NAV_SETTINGS_LINK,
  flattenAppNavLinks,
  isParkedNavHref,
  type AppNavGroup,
  type AppNavLink,
} from './app-nav-catalog';
import { markOnboardingSetWorkspace } from './onboarding-hooks';

export type WorkspaceMode = 'simple' | 'play' | 'studio' | 'full';

const MODE_KEY = 'comfy-workspace-mode-v1';
const CHOSEN_KEY = 'comfy-workspace-mode-chosen-v1';

export const WORKSPACE_MODE_CHANGED_EVENT = 'workspace-mode-changed';
export const WORKSPACE_MODE_COOKIE = 'comfy-workspace-mode-v1';

function persistWorkspaceModeCookie(mode: WorkspaceMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    document.cookie = `${WORKSPACE_MODE_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* private mode / mocked document */
  }
}

export const WORKSPACE_MODE_OPTIONS: {
  id: WorkspaceMode;
  label: string;
  description: string;
}[] = [
  {
    id: 'play',
    label: 'Play',
    description:
      'Campaign, Moodboard, Fitting, Day, Roleplay, Gallery, and Queue — the flagship film loop.',
  },
  {
    id: 'simple',
    label: 'Simple',
    description: 'Essentials in the sidebar; advanced tools under More. Lean shared controls.',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Full catalog in Edit / Media / Library / Extras. Collapsed advanced controls.',
  },
  {
    id: 'full',
    label: 'Full',
    description: 'Everything visible — power-user layout with advanced controls ready.',
  },
];

/** Primary destinations for Simple workspace (path or path?query). */
export const SIMPLE_NAV_HREFS = [
  '/dashboard',
  '/',
  '/play',
  '/characters',
  '/roleplay',
  '/gallery',
  '/queue',
] as const;

/** Preferred order inside Simple “More tools” (still reachable via ⌘K). */
export const SIMPLE_MORE_NAV_HREFS = [
  '/m',
  '/character',
  '/video',
  '/refine',
  '/compose',
  '/inpaint',
  '/studio',
  '/fitting',
  '/day',
  '/moodboard',
  '/image-prompt',
  '/format',
] as const;

/**
 * Routes that slim chrome to Play: Cast, Roleplay, Gallery, Queue, plus All tools.
 * Character home (`/characters/[id]`) is included; `/character` (the generator) is not.
 */
export const ROLEPLAY_FOCUS_HREFS = [
  '/play',
  '/roleplay',
  '/fitting',
  '/day',
  '/moodboard',
  '/characters',
] as const;

/** Destinations listed in the Play sidebar (All tools is appended separately). */
export const ROLEPLAY_FOCUS_NAV_HREFS = [
  '/characters',
  '/play',
  '/moodboard',
  '/fitting',
  '/day',
  '/roleplay',
  '/gallery',
  '/queue',
] as const;

/** Escape hatch so Play focus is not a trap — Generate, labeled All tools. */
export const ROLEPLAY_FOCUS_ESCAPE_HREF = '/';

export function isRoleplayFocusPath(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return false;
  }
  const path = pathname.split('?')[0] || '/';
  return (
    path === '/play' ||
    path === '/roleplay' ||
    path === '/fitting' ||
    path === '/day' ||
    path === '/moodboard' ||
    path === '/characters' ||
    path.startsWith('/characters/')
  );
}

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  if (value === 'simple' || value === 'play' || value === 'studio' || value === 'full') {
    return value;
  }
  // First-run / unknown → Play (flagship Cast → Moodboard → Fitting → Day → Roleplay loop).
  return 'play';
}

export function loadWorkspaceMode(): WorkspaceMode {
  if (typeof window === 'undefined') {
    return 'play';
  }
  return normalizeWorkspaceMode(readBrowserString(MODE_KEY));
}

export function saveWorkspaceMode(mode: WorkspaceMode): void {
  if (typeof window === 'undefined') {
    return;
  }
  const next = normalizeWorkspaceMode(mode);
  writeBrowserString(MODE_KEY, next);
  writeBrowserString(CHOSEN_KEY, '1');
  document.documentElement.dataset.workspace = next;
  persistWorkspaceModeCookie(next);
  markOnboardingSetWorkspace();
  window.dispatchEvent(new Event(WORKSPACE_MODE_CHANGED_EVENT));
}

export function hasChosenWorkspaceMode(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return readBrowserString(CHOSEN_KEY) === '1';
}

/** Returning users already have chrome prefs — don't force the welcome dialog. */
function hasExistingChromePrefs(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(
    readBrowserString('comfy-nav-favorites-v1') ||
    readBrowserString('comfy-ui-density-v1') ||
    readBrowserString('comfy-nav-expanded-groups-v1') ||
    readBrowserString('comfy-recent-destinations-v1')
  );
}

export function applyWorkspaceMode(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (!hasChosenWorkspaceMode() && hasExistingChromePrefs()) {
    writeBrowserString(CHOSEN_KEY, '1');
  }
  document.documentElement.dataset.workspace = loadWorkspaceMode();
  persistWorkspaceModeCookie(loadWorkspaceMode());
}

export function clearWorkspaceModeChoice(): void {
  if (typeof window === 'undefined') {
    return;
  }
  writeBrowserString(CHOSEN_KEY, '');
}

export function isLeanWorkspaceMode(mode: WorkspaceMode): boolean {
  return mode === 'simple' || mode === 'play';
}

function playNavGroups(baseGroups: AppNavGroup[]): AppNavGroup[] {
  const catalog = flattenAppNavLinks(baseGroups);
  const playLinks = ROLEPLAY_FOCUS_NAV_HREFS.map(href => linkByHref(href, catalog)).filter(
    (link): link is AppNavLink => Boolean(link)
  );
  const escape = linkByHref(ROLEPLAY_FOCUS_ESCAPE_HREF, catalog) ?? {
    href: ROLEPLAY_FOCUS_ESCAPE_HREF,
    label: 'Generate',
    description: 'Keywords or random scene',
  };
  return [
    {
      label: 'Play',
      links: [
        ...playLinks,
        {
          ...escape,
          label: 'All tools',
          description: 'Leave Play and open the full studio',
        },
      ],
    },
  ];
}

function hrefKey(href: string): string {
  return href.split('?')[0] || '/';
}

function linkByHref(href: string, catalog: AppNavLink[]): AppNavLink | undefined {
  return (
    catalog.find(link => link.href === href) ??
    catalog.find(link => hrefKey(link.href) === hrefKey(href))
  );
}

/**
 * Studio/Full IA: split the old mega-Tools list into Edit / Media / Library.
 * Simple: Essentials + More tools.
 */
export function navGroupsForWorkspaceMode(
  mode: WorkspaceMode,
  baseGroups: AppNavGroup[] = APP_NAV_GROUPS
): AppNavGroup[] {
  const flat = flattenAppNavLinks(baseGroups);
  const byHref = (href: string) => linkByHref(href, flat);

  if (mode === 'play') {
    return playNavGroups(baseGroups);
  }

  if (mode === 'simple') {
    const essentials = SIMPLE_NAV_HREFS.map(href => byHref(href)).filter(
      (link): link is AppNavLink => Boolean(link)
    );
    const essentialKeys = new Set(essentials.map(link => link.href));
    const morePreferred = SIMPLE_MORE_NAV_HREFS.map(href => byHref(href)).filter(
      (link): link is AppNavLink => Boolean(link)
    );
    const moreRest = flat.filter(
      link => !essentialKeys.has(link.href) && !morePreferred.some(item => item.href === link.href)
    );
    // Parked specialty tools stay reachable but sort last under More.
    const moreActive = moreRest.filter(link => !isParkedNavHref(link.href));
    const moreParked = moreRest.filter(link => isParkedNavHref(link.href));
    const more = [...morePreferred, ...moreActive, ...moreParked];
    const groups: AppNavGroup[] = [{ label: 'Essentials', links: essentials }];
    if (more.length > 0) {
      groups.push({ label: 'More tools', links: more });
    }
    return groups;
  }

  // Studio + Full share the same group structure (baseGroups already restructured).
  return baseGroups;
}

/**
 * Workspace groups, then Play-route slim or Play workspace kiosk.
 * Play mode uses the same destinations on every path.
 */
export function usesPlayChrome(mode: WorkspaceMode, pathname?: string | null): boolean {
  return mode === 'play' || isRoleplayFocusPath(pathname);
}

export function navGroupsForPath(
  mode: WorkspaceMode,
  pathname: string,
  baseGroups: AppNavGroup[] = APP_NAV_GROUPS
): AppNavGroup[] {
  if (usesPlayChrome(mode, pathname)) {
    return playNavGroups(baseGroups);
  }
  return navGroupsForWorkspaceMode(mode, baseGroups);
}

export function isRoleplayFocusNavHref(href: string): boolean {
  const path = href.split('?')[0] || '/';
  if (path === ROLEPLAY_FOCUS_ESCAPE_HREF || path === '/settings' || path === '/profile') {
    return true;
  }
  if ((ROLEPLAY_FOCUS_NAV_HREFS as readonly string[]).includes(path)) {
    return true;
  }
  return path.startsWith('/characters/');
}

/** Default expanded group labels for a workspace mode when the user has no saved prefs. */
export function defaultExpandedNavGroups(mode: WorkspaceMode, groups: AppNavGroup[]): string[] {
  if (groups.some(group => group.label === 'Roleplay') || mode === 'play') {
    return ['Roleplay'];
  }
  if (mode === 'simple') {
    return ['Essentials'];
  }
  if (mode === 'full') {
    return groups.map(group => group.label);
  }
  // Studio: keep Media + parked Extras collapsed by default to reduce noise.
  return groups
    .map(group => group.label)
    .filter(label => label !== 'Media' && label !== APP_NAV_EXTRAS_GROUP_LABEL);
}

export function workspaceShowsAdvancedControls(mode: WorkspaceMode): boolean {
  return !isLeanWorkspaceMode(mode);
}

export function workspaceControlsDefaultOpen(mode: WorkspaceMode): boolean {
  return mode === 'full';
}

export { APP_NAV_SETTINGS_LINK };
