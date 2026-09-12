/**
 * Guided Play loop: Moodboard → Fitting → Day → Roleplay.
 * State travels via session look pack + query params.
 */

import { readBrowserValue, writeBrowserValue } from './browser-storage';
import type { LookPack } from './look-pack';
import {
  lookPackDayHref,
  lookPackFittingHref,
  lookPackRoleplayHref,
  saveLookPack,
} from './look-pack';

export type PlayCampaignStepId = 'character' | 'moodboard' | 'fitting' | 'day' | 'roleplay';

export type PlayCampaignStep = {
  id: PlayCampaignStepId;
  label: string;
  description: string;
  href: (input: { characterId: string; pack?: LookPack | null }) => string;
};

export const PLAY_CAMPAIGN_STEPS: PlayCampaignStep[] = [
  {
    id: 'character',
    label: 'Cast',
    description: 'Pick the character this campaign belongs to.',
    href: ({ characterId }) => `/characters/${encodeURIComponent(characterId)}`,
  },
  {
    id: 'moodboard',
    label: 'Moodboard',
    description: 'Stack refs and extract a look pack (or pick a saved one on Cast).',
    href: ({ characterId }) => `/moodboard?character=${encodeURIComponent(characterId)}`,
  },
  {
    id: 'fitting',
    label: 'Fitting',
    description: 'Swipe wardrobe kits on the locked plate.',
    href: ({ characterId, pack }) =>
      pack ? lookPackFittingHref(pack) : `/fitting?character=${encodeURIComponent(characterId)}`,
  },
  {
    id: 'day',
    label: 'Day',
    description: 'Plan morning → night, queue stills, animate slots, Cut film.',
    href: ({ characterId, pack }) =>
      pack ? lookPackDayHref(pack) : `/day?character=${encodeURIComponent(characterId)}`,
  },
  {
    id: 'roleplay',
    label: 'Roleplay',
    description: 'Optional — alternate ending with beats and clips, or skip after a Day cut.',
    href: ({ characterId, pack }) =>
      pack ? lookPackRoleplayHref(pack) : `/roleplay?character=${encodeURIComponent(characterId)}`,
  },
];

export const PLAY_CAMPAIGN_KEY = 'play-campaign-v1';

export type PlayCampaignState = {
  version: 1;
  characterId: string;
  lookPackId?: string;
  stepIndex: number;
  /** Set when Day/Roleplay Cut film closes the campaign loop. */
  completedAt?: number;
  updatedAt: number;
};

function normalizePlayCampaignState(value: unknown): PlayCampaignState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const parsed = value as Partial<PlayCampaignState>;
  if (parsed.version !== 1 || !parsed.characterId?.trim()) {
    return null;
  }
  return {
    version: 1,
    characterId: parsed.characterId.trim(),
    lookPackId: parsed.lookPackId?.trim() || undefined,
    stepIndex:
      typeof parsed.stepIndex === 'number'
        ? Math.max(0, Math.min(PLAY_CAMPAIGN_STEPS.length - 1, parsed.stepIndex))
        : 0,
    completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : undefined,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

export function savePlayCampaignState(state: PlayCampaignState): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized = normalizePlayCampaignState(state);
  if (!normalized) {
    return;
  }
  writeBrowserValue(PLAY_CAMPAIGN_KEY, normalized);
  // Mirror to sessionStorage so same-tab e2e seeds and in-flight handoffs keep working.
  try {
    window.sessionStorage.setItem(PLAY_CAMPAIGN_KEY, JSON.stringify(normalized));
  } catch {
    /* private mode */
  }
}

function readSessionPlayCampaignState(): PlayCampaignState | null {
  try {
    const raw = window.sessionStorage.getItem(PLAY_CAMPAIGN_KEY);
    if (!raw) {
      return null;
    }
    return normalizePlayCampaignState(JSON.parse(raw) as unknown);
  } catch {
    window.sessionStorage.removeItem(PLAY_CAMPAIGN_KEY);
    return null;
  }
}

function mergePlayCampaignState(
  durable: PlayCampaignState,
  session: PlayCampaignState
): PlayCampaignState {
  if (durable.characterId !== session.characterId) {
    return durable.updatedAt >= session.updatedAt ? durable : session;
  }
  return {
    version: 1,
    characterId: durable.characterId,
    lookPackId: durable.lookPackId?.trim() || session.lookPackId?.trim() || undefined,
    stepIndex: Math.max(durable.stepIndex, session.stepIndex),
    completedAt: durable.completedAt ?? session.completedAt,
    updatedAt: Math.max(durable.updatedAt, session.updatedAt),
  };
}

export function loadPlayCampaignState(): PlayCampaignState | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const durable = normalizePlayCampaignState(readBrowserValue(PLAY_CAMPAIGN_KEY));
  const session = readSessionPlayCampaignState();
  if (durable && session) {
    const merged = mergePlayCampaignState(durable, session);
    if (
      merged.lookPackId !== durable.lookPackId ||
      merged.stepIndex !== durable.stepIndex ||
      merged.completedAt !== durable.completedAt
    ) {
      writeBrowserValue(PLAY_CAMPAIGN_KEY, merged);
    }
    return merged;
  }
  if (durable) {
    return durable;
  }
  if (session) {
    writeBrowserValue(PLAY_CAMPAIGN_KEY, session);
    return session;
  }
  return null;
}

/** Stage look pack for the next Play tool hop. */
export function stagePlayCampaignHandoff(pack: LookPack): void {
  saveLookPack(pack);
}

export function playCampaignHref(characterId: string, lookPackId?: string): string {
  const params = new URLSearchParams();
  params.set('character', characterId);
  if (lookPackId?.trim()) {
    params.set('lookPack', lookPackId.trim());
  }
  return `/play?${params.toString()}`;
}

export function clearPlayCampaignState(): void {
  if (typeof window === 'undefined') {
    return;
  }
  writeBrowserValue(PLAY_CAMPAIGN_KEY, null);
  try {
    window.sessionStorage.removeItem(PLAY_CAMPAIGN_KEY);
  } catch {
    /* private mode */
  }
}

/** Prefer query look pack id, then durable campaign resume id. */
export function resolveCampaignLookPackId(input: {
  queryLookPackId?: string;
  savedLookPackId?: string;
}): string | undefined {
  const fromQuery = input.queryLookPackId?.trim();
  if (fromQuery) {
    return fromQuery;
  }
  const fromSaved = input.savedLookPackId?.trim();
  return fromSaved || undefined;
}

/**
 * Advance (or set) campaign resume step for desk handoffs.
 * Skips when a different character owns the saved campaign.
 * Default is monotonic — never moves resume backward.
 */
export function bumpPlayCampaignStep(input: {
  characterId: string;
  stepId: PlayCampaignStepId;
  lookPackId?: string;
  /** When true, set absolute stepIndex (wizard Restart). */
  absolute?: boolean;
}): PlayCampaignState | null {
  const characterId = input.characterId.trim();
  if (!characterId) {
    return null;
  }
  const stepIndex = PLAY_CAMPAIGN_STEPS.findIndex(entry => entry.id === input.stepId);
  if (stepIndex < 0) {
    return null;
  }
  const saved = loadPlayCampaignState();
  if (saved && saved.characterId !== characterId) {
    return null;
  }
  const nextIndex = input.absolute ? stepIndex : Math.max(saved?.stepIndex ?? 0, stepIndex);
  const next: PlayCampaignState = {
    version: 1,
    characterId,
    lookPackId: input.lookPackId?.trim() || saved?.lookPackId,
    stepIndex: nextIndex,
    completedAt: saved?.completedAt,
    updatedAt: Date.now(),
  };
  savePlayCampaignState(next);
  void import('./local-observability').then(
    ({ noteCampaignStepMetric, noteCampaignMaxStepMetric }) => {
      noteCampaignStepMetric();
      noteCampaignMaxStepMetric(nextIndex);
    }
  );
  return next;
}

/** Mark the Play campaign loop complete after a successful Cut film. */
export function completePlayCampaign(input: {
  characterId: string;
  lookPackId?: string;
  /** Step that closed the loop — Day cut stays on Day; Roleplay cut lands on Roleplay. */
  stepId?: PlayCampaignStepId;
}): PlayCampaignState | null {
  const characterId = input.characterId.trim();
  if (!characterId) {
    return null;
  }
  const saved = loadPlayCampaignState();
  if (saved && saved.characterId !== characterId) {
    return null;
  }
  const preferredId = input.stepId === 'roleplay' ? 'roleplay' : 'day';
  const preferredIndex = PLAY_CAMPAIGN_STEPS.findIndex(entry => entry.id === preferredId);
  const dayIndex = PLAY_CAMPAIGN_STEPS.findIndex(entry => entry.id === 'day');
  const next: PlayCampaignState = {
    version: 1,
    characterId,
    lookPackId: input.lookPackId?.trim() || saved?.lookPackId,
    stepIndex:
      preferredIndex >= 0
        ? preferredIndex
        : dayIndex >= 0
          ? dayIndex
          : PLAY_CAMPAIGN_STEPS.length - 1,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
  savePlayCampaignState(next);
  void import('./local-observability').then(({ noteCampaignMaxStepMetric }) => {
    noteCampaignMaxStepMetric(next.stepIndex);
  });
  return next;
}
