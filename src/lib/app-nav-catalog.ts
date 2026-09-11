/** Shared nav catalog for AppNav + Command Palette. */

export type AppNavLink = {
  href: string;
  label: string;
  description: string;
};

export type AppNavGroup = {
  label: string;
  links: AppNavLink[];
};

/** Sidebar group for soft-deprecated specialty tools (still reachable via ⌘K / direct URL). */
export const APP_NAV_EXTRAS_GROUP_LABEL = 'Extras';

export const APP_NAV_GROUPS: AppNavGroup[] = [
  {
    label: 'Overview',
    links: [
      { href: '/dashboard', label: 'Dashboard', description: 'Jobs, queue & recent outputs' },
      { href: '/queue', label: 'Queue', description: 'Central ComfyUI job queue' },
      {
        href: '/m',
        label: 'Mobile Studio',
        description: 'Phone film loop — Capture, Board, Fit, Day, Play + Cut',
      },
    ],
  },
  {
    label: 'Prompt',
    links: [
      { href: '/', label: 'Generate', description: 'Keywords or random scene' },
      { href: '/format', label: 'Format', description: 'Draft → model-ready' },
      { href: '/prompt', label: 'Prompt Editor', description: 'Edit & optimize' },
      { href: '/lint', label: 'Lint', description: 'Diagnostics & fix' },
    ],
  },
  {
    label: 'Scene',
    links: [
      {
        href: '/characters',
        label: 'Cast',
        description: 'Character home — looks, stills, clips, and LoRA',
      },
      {
        href: '/character',
        label: 'Character',
        description: 'Person, pet, fantasy, or environment — switch on the page',
      },
      {
        href: '/play',
        label: 'Play campaign',
        description: 'Guided Moodboard → Fitting → Day → Roleplay loop',
      },
      {
        href: '/roleplay',
        label: 'Roleplay',
        description: 'Be someone. Pick a scene. Get a still or clip.',
      },
      {
        href: '/fitting',
        label: 'Fitting Room',
        description: 'Try a catalog kit on a Cast plate',
      },
      {
        href: '/day',
        label: 'Day Planner',
        description: 'Morning through night — wardrobe, setting, and beats per slot',
      },
      {
        href: '/moodboard',
        label: 'Moodboard',
        description: 'Reference tiles merged into one scene still',
      },
    ],
  },
  {
    label: 'Edit',
    links: [
      { href: '/image-prompt', label: 'Image → Prompt', description: 'Vision upload' },
      { href: '/refine', label: 'Refine', description: 'Image + intent fix' },
      { href: '/inpaint', label: 'Inpaint', description: 'Mask + region prompt' },
      {
        href: '/outpaint',
        label: 'Outpaint',
        description: 'Expand canvas borders',
      },
      {
        href: '/compose',
        label: 'Compose',
        description: 'Multi-image transfer & edit',
      },
      {
        href: '/workflow-editor',
        label: 'Workflow editor',
        description: 'Edit Comfy node graphs',
      },
      { href: '/controlnet', label: 'ControlNet', description: 'Structure prompts' },
      { href: '/negative', label: 'Negative', description: 'SD negatives' },
    ],
  },
  {
    label: 'Media',
    links: [{ href: '/video', label: 'Video', description: 'Motion prompts' }],
  },
  {
    label: 'Library',
    links: [
      { href: '/studio', label: 'Studio', description: 'History, presets, and compare' },
      { href: '/gallery', label: 'Gallery', description: 'ComfyUI outputs' },
      { href: '/variations', label: 'Variations', description: 'Grid queue and matrix sweeps' },
      { href: '/plugins', label: 'Plugins', description: 'Runtime manifests and nav bookmarks' },
    ],
  },
  {
    label: APP_NAV_EXTRAS_GROUP_LABEL,
    links: [
      {
        href: '/topics',
        label: 'Topics',
        description: 'Idea list — parked specialty; prefer Generate / Play',
      },
      {
        href: '/audio',
        label: 'Audio',
        description: 'Sound / music prompts — parked specialty tool',
      },
      {
        href: '/mesh',
        label: '3D Mesh',
        description: 'Image → mesh prompts — parked specialty tool',
      },
      {
        href: '/logo',
        label: 'Logo',
        description: 'SVG marks & raster logo prompts — parked specialty tool',
      },
    ],
  },
];

export const APP_NAV_SETTINGS_LINK: AppNavLink = {
  href: '/settings',
  label: 'Settings',
  description: 'Health & ComfyUI',
};

export const APP_NAV_PROFILE_LINK: AppNavLink = {
  href: '/profile',
  label: 'Profile',
  description: 'Appearance & account',
};

/** Legacy scene routes — command palette only; Character page switcher covers these families. */
export const APP_NAV_SCENE_ALIASES: AppNavLink[] = [
  {
    href: '/background',
    label: 'Background (scene)',
    description: 'Environment-only — opens Background tool',
  },
  { href: '/pet', label: 'Pet (scene)', description: 'Dogs, cats & more — opens Pet tool' },
  { href: '/fantasy', label: 'Fantasy (scene)', description: 'Magic & myth — opens Fantasy tool' },
];

/** Soft-deprecated specialty hrefs (Extras group + legacy scene aliases). */
export const APP_NAV_PARKED_HREFS = [
  '/topics',
  '/audio',
  '/mesh',
  '/logo',
  '/pet',
  '/fantasy',
  '/background',
] as const;

export function isParkedNavHref(href: string): boolean {
  const path = href.split('?')[0] || '/';
  return (APP_NAV_PARKED_HREFS as readonly string[]).includes(path);
}

export function flattenAppNavLinks(
  groups: AppNavGroup[] = APP_NAV_GROUPS,
  options?: { includeSceneAliases?: boolean }
): AppNavLink[] {
  const links = groups.flatMap(group => group.links);
  if (!options?.includeSceneAliases) {
    return links;
  }
  const seen = new Set(links.map(link => link.href.split('?')[0] ?? link.href));
  for (const alias of APP_NAV_SCENE_ALIASES) {
    const path = alias.href.split('?')[0] ?? alias.href;
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    links.push(alias);
  }
  return links;
}

/**
 * Append plugin-contributed links into the Library group, skipping hrefs already
 * present in the catalog (path match, query ignored).
 */
export function mergePluginLinksIntoNav(
  groups: AppNavGroup[] = APP_NAV_GROUPS,
  pluginLinks: AppNavLink[]
): AppNavGroup[] {
  if (!pluginLinks.length) {
    return groups;
  }
  const existing = new Set(
    groups.flatMap(group => group.links.map(link => link.href.split('?')[0] ?? link.href))
  );
  const unique = pluginLinks.filter(link => {
    const path = link.href.split('?')[0] ?? link.href;
    if (existing.has(path)) {
      return false;
    }
    existing.add(path);
    return true;
  });
  if (!unique.length) {
    return groups;
  }
  let merged = false;
  const next = groups.map(group => {
    if (group.label !== 'Library' && group.label !== 'Tools') {
      return group;
    }
    merged = true;
    return { ...group, links: [...group.links, ...unique] };
  });
  if (merged) {
    return next;
  }
  return [...next, { label: 'Plugins', links: unique }];
}
