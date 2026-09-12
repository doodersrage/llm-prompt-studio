/**
 * Local Play-loop success metrics (timestamps).
 * Complements boolean onboarding steps with funnel timing.
 */

import { readBrowserValue, writeBrowserValue } from './browser-storage';
import type { LookPack } from './look-pack';
import { lookPackDayHref, lookPackFittingHref, lookPackRoleplayHref } from './look-pack';

export const PLAY_METRICS_KEY = 'comfy-play-metrics-v1';

export const PLAY_METRICS_UPDATED_EVENT = 'play-metrics-updated';

export type PlayMetrics = {
  version: 1;
  /** First time the user left Play campaign into a step past Cast. */
  firstPlayCampaignAt?: number;
  /** First successful Cut film (Day or Roleplay). */
  firstFilmCutAt?: number;
};

function normalizePlayMetrics(value: unknown): PlayMetrics {
  if (!value || typeof value !== 'object') {
    return { version: 1 };
  }
  const raw = value as Partial<PlayMetrics>;
  return {
    version: 1,
    firstPlayCampaignAt:
      typeof raw.firstPlayCampaignAt === 'number' ? raw.firstPlayCampaignAt : undefined,
    firstFilmCutAt: typeof raw.firstFilmCutAt === 'number' ? raw.firstFilmCutAt : undefined,
  };
}

export function loadPlayMetrics(): PlayMetrics {
  if (typeof window === 'undefined') {
    return { version: 1 };
  }
  return normalizePlayMetrics(readBrowserValue(PLAY_METRICS_KEY));
}

export function savePlayMetrics(metrics: PlayMetrics): void {
  if (typeof window === 'undefined') {
    return;
  }
  writeBrowserValue(PLAY_METRICS_KEY, normalizePlayMetrics(metrics));
  window.dispatchEvent(new Event(PLAY_METRICS_UPDATED_EVENT));
}

/** Returns true the first time campaign start is recorded. */
export function recordFirstPlayCampaignStart(at = Date.now()): boolean {
  const current = loadPlayMetrics();
  if (current.firstPlayCampaignAt) {
    return false;
  }
  savePlayMetrics({ ...current, firstPlayCampaignAt: at });
  return true;
}

/** Returns true the first time a film cut is recorded. */
export function recordFirstFilmCut(at = Date.now()): boolean {
  const current = loadPlayMetrics();
  if (current.firstFilmCutAt) {
    return false;
  }
  savePlayMetrics({ ...current, firstFilmCutAt: at });
  return true;
}

/**
 * Days between first campaign start and first film cut.
 * Null when either timestamp is missing.
 */
export function daysFromCampaignStartToFirstFilmCut(
  metrics: PlayMetrics = loadPlayMetrics()
): number | null {
  if (!metrics.firstPlayCampaignAt || !metrics.firstFilmCutAt) {
    return null;
  }
  if (metrics.firstFilmCutAt < metrics.firstPlayCampaignAt) {
    return 0;
  }
  return (metrics.firstFilmCutAt - metrics.firstPlayCampaignAt) / (1000 * 60 * 60 * 24);
}

/** True when the user cut a film within `withinDays` of starting a campaign. */
export function firstFilmCutWithinDays(
  withinDays: number,
  metrics: PlayMetrics = loadPlayMetrics()
): boolean | null {
  const days = daysFromCampaignStartToFirstFilmCut(metrics);
  if (days === null) {
    return null;
  }
  return days <= withinDays;
}

export type PlayNextAction = {
  label: string;
  href: string;
  reason: string;
};

export type PlayFunnelStepId = 'character' | 'moodboard' | 'fitting' | 'day' | 'roleplay' | 'cut';

export type PlayFunnelStall = {
  stepId: PlayFunnelStepId;
  stepLabel: string;
  reason: string;
  /** Days since first campaign start; null when start time is unknown. */
  daysSinceCampaignStart: number | null;
};

const PLAY_FUNNEL_STEP_LABELS: Record<PlayFunnelStepId, string> = {
  character: 'Cast',
  moodboard: 'Moodboard',
  fitting: 'Fitting',
  day: 'Day Planner',
  roleplay: 'Roleplay',
  cut: 'Cut film',
};

/** Deep-link for a Play funnel step chip or stall CTA. */
export function resolvePlayFunnelStepHref(
  stepId: PlayFunnelStepId,
  characterId?: string,
  pack?: LookPack | null
): string {
  const id = characterId?.trim() || pack?.characterId?.trim() || '';
  const staged =
    pack &&
    ({
      ...pack,
      characterId: id || pack.characterId,
    } satisfies LookPack);

  switch (stepId) {
    case 'character':
      return id ? `/characters/${encodeURIComponent(id)}` : '/characters';
    case 'moodboard':
      return id ? `/moodboard?character=${encodeURIComponent(id)}` : '/moodboard';
    case 'fitting':
      if (staged) {
        return lookPackFittingHref(staged);
      }
      return id ? `/fitting?character=${encodeURIComponent(id)}` : '/fitting';
    case 'day':
    case 'cut':
      if (staged) {
        return lookPackDayHref(staged);
      }
      return id ? `/day?character=${encodeURIComponent(id)}` : '/day';
    case 'roleplay':
      if (staged) {
        return lookPackRoleplayHref(staged);
      }
      return id ? `/roleplay?character=${encodeURIComponent(id)}` : '/roleplay';
    default:
      return '/play';
  }
}

type FunnelLike = {
  firstPlayCampaign?: number;
  firstFilmCut?: number;
  keepTryOn?: number;
  saveToCast?: number;
  campaignMaxStep?: number;
};

type CampaignLike = {
  characterId: string;
  lookPackId?: string;
  stepIndex: number;
  completedAt?: number;
} | null;

/**
 * Next CTA for Dashboard Play metrics — prefers live campaign step, then funnel stall heuristics.
 * After first film + Cast save/watch, pushes a second Day cut (habit loop).
 */
export function resolveNextPlayAction(input: {
  metrics?: PlayMetrics;
  funnel?: FunnelLike | null;
  campaign?: CampaignLike;
  watchedFirstFilm?: boolean;
  /** Session look pack when available — enriches Fitting/Day resume deep-links. */
  lookPack?: LookPack | null;
}): PlayNextAction {
  const funnel = input.funnel ?? {};
  const campaign = input.campaign ?? null;
  const starts = funnel.firstPlayCampaign || 0;
  const cuts = funnel.firstFilmCut || 0;
  const keeps = funnel.keepTryOn || 0;
  const saves = funnel.saveToCast || 0;
  const watched = input.watchedFirstFilm === true;
  const characterId = campaign?.characterId?.trim() || '';
  const pack =
    input.lookPack && characterId
      ? { ...input.lookPack, characterId: input.lookPack.characterId || characterId }
      : input.lookPack;

  if (campaign?.completedAt && cuts > 0 && saves === 0 && characterId) {
    return {
      label: 'Save film to Cast',
      href: `/characters/${encodeURIComponent(characterId)}?media=films`,
      reason: 'Film cut — stamp a Cast copy to close the loop.',
    };
  }

  if (campaign?.completedAt && cuts > 0 && characterId) {
    if (!watched) {
      return {
        label: 'Watch film on Cast',
        href: `/characters/${encodeURIComponent(characterId)}?media=films`,
        reason: 'Rewatch the cut on Cast, then queue another Day reel.',
      };
    }
    return {
      label: 'Cut another Day film',
      href: resolvePlayFunnelStepHref('day', characterId, pack),
      reason: 'Loop closed — cut another Day film or start a new campaign from Play.',
    };
  }

  if (campaign && !campaign.completedAt && characterId) {
    const stepIndex = Math.max(0, Math.min(campaign.stepIndex, 4));
    const stepIds = ['character', 'moodboard', 'fitting', 'day', 'roleplay'] as const;
    const id = stepIds[stepIndex] ?? 'moodboard';
    const labels: Record<(typeof stepIds)[number], string> = {
      character: 'Open Cast',
      moodboard: 'Continue Moodboard',
      fitting: 'Continue Fitting',
      day: 'Continue Day · Cut film',
      roleplay: 'Optional Roleplay · or Cut in Day',
    };
    return {
      label: labels[id],
      href: resolvePlayFunnelStepHref(id, characterId, pack),
      reason: 'Resume your active Play campaign at the current step.',
    };
  }

  if (starts > 0 && cuts === 0) {
    return {
      label: 'Cut film in Day',
      href: resolvePlayFunnelStepHref('day', characterId || undefined, pack),
      reason: 'Campaign started — Cut film in Day (Roleplay is optional).',
    };
  }
  if (keeps > 0 && cuts === 0) {
    return {
      label: 'Continue in Day',
      href: resolvePlayFunnelStepHref('day', characterId || undefined, pack),
      reason: 'Keepers saved — Continue in Day and Cut film.',
    };
  }
  if (cuts > 0 && saves === 0) {
    return {
      label: 'Open Cast films',
      href: characterId
        ? `/characters/${encodeURIComponent(characterId)}?media=films`
        : '/characters',
      reason: 'Film cut — Save to Cast to stamp a studio copy.',
    };
  }
  if (cuts > 0 && saves > 0) {
    return {
      label: watched ? 'Cut another Day film' : 'Watch film on Cast',
      href: watched
        ? resolvePlayFunnelStepHref('day', characterId || undefined, pack)
        : characterId
          ? `/characters/${encodeURIComponent(characterId)}?media=films`
          : '/characters',
      reason: watched
        ? 'Habit loop — queue another Day reel or open Play for a new campaign.'
        : 'Film saved — open Cast to watch, then cut another.',
    };
  }

  return {
    label: 'Open Play campaign',
    href: '/play',
    reason: 'Start Moodboard → Fitting → Day → film.',
  };
}

/**
 * Where the Play funnel is stuck before the first film cut — for dashboard stall callouts.
 */
export function resolvePlayFunnelStall(input: {
  metrics?: PlayMetrics;
  funnel?: FunnelLike | null;
  campaign?: CampaignLike;
}): PlayFunnelStall | null {
  const metrics = input.metrics ?? { version: 1 };
  const funnel = input.funnel ?? {};
  const campaign = input.campaign ?? null;

  const hasCut = Boolean(metrics.firstFilmCutAt) || (funnel.firstFilmCut ?? 0) > 0;
  if (hasCut) {
    return null;
  }

  const started = Boolean(metrics.firstPlayCampaignAt) || (funnel.firstPlayCampaign ?? 0) > 0;
  if (!started) {
    return null;
  }

  const daysSinceCampaignStart =
    typeof metrics.firstPlayCampaignAt === 'number'
      ? Math.max(0, (Date.now() - metrics.firstPlayCampaignAt) / (1000 * 60 * 60 * 24))
      : null;

  const keeps = funnel.keepTryOn ?? 0;
  const maxStep = Math.max(campaign?.stepIndex ?? -1, (funnel.campaignMaxStep ?? 0) - 1, 0);

  if (keeps > 0 || maxStep >= 3) {
    return {
      stepId: 'cut',
      stepLabel: PLAY_FUNNEL_STEP_LABELS.cut,
      reason: 'Try-ons saved — Cut film in Day to close the loop (Roleplay is optional).',
      daysSinceCampaignStart,
    };
  }

  const stepIds = ['character', 'moodboard', 'fitting', 'day', 'roleplay'] as const;
  const stepId = stepIds[Math.min(maxStep, stepIds.length - 1)] ?? 'moodboard';
  const reasons: Record<(typeof stepIds)[number], string> = {
    character: 'Pick a Cast character and start Moodboard.',
    moodboard: 'Extract a look pack on Moodboard, then continue to Fitting.',
    fitting: 'Queue try-ons in Fitting and Keep a plate before Day.',
    day: 'Plan Day slots and queue stills before Cut film.',
    roleplay: 'Optional — cut in Day instead, or run a Roleplay beat then Cut film.',
  };

  return {
    stepId,
    stepLabel: PLAY_FUNNEL_STEP_LABELS[stepId],
    reason: reasons[stepId],
    daysSinceCampaignStart,
  };
}
