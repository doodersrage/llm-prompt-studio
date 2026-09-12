'use client';

import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { StatCard, ToolSection } from '@/components/ui/ToolPageShell';
import { scheduleAfterCommit } from '@/lib/schedule-after-commit';
import {
  loadLocalObservability,
  summarizePlayFunnel,
  type LocalObservabilityCounters,
} from '@/lib/local-observability';
import { loadPlayCampaignState, PLAY_CAMPAIGN_STEPS } from '@/lib/play-campaign';
import { loadLookPack } from '@/lib/look-pack';
import { loadOnboardingState } from '@/lib/onboarding-store';
import {
  daysFromCampaignStartToFirstFilmCut,
  firstFilmCutWithinDays,
  loadPlayMetrics,
  PLAY_METRICS_UPDATED_EVENT,
  resolveNextPlayAction,
  resolvePlayFunnelStall,
  resolvePlayFunnelStepHref,
  type PlayMetrics,
} from '@/lib/play-metrics';
import type { LookPack } from '@/lib/look-pack';

function formatDays(days: number): string {
  if (days < 1) {
    return 'same day';
  }
  if (days < 1.05) {
    return '1 day';
  }
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

function formatRate(rate: number | null): string {
  if (rate == null) {
    return '—';
  }
  return `${Math.round(rate * 100)}%`;
}

export default function PlayFilmMetricsCard() {
  const [metrics, setMetrics] = useState<PlayMetrics>({ version: 1 });
  const [funnel, setFunnel] = useState<LocalObservabilityCounters | null>(null);
  const [campaignStep, setCampaignStep] = useState<{
    characterId: string;
    lookPackId?: string;
    stepIndex: number;
    completedAt?: number;
  } | null>(null);

  const [watchedFirstFilm, setWatchedFirstFilm] = useState(false);
  const [lookPack, setLookPack] = useState<LookPack | null>(null);

  useEffect(() => {
    const refresh = () => {
      scheduleAfterCommit(() => {
        setMetrics(loadPlayMetrics());
        setFunnel(loadLocalObservability());
        setCampaignStep(loadPlayCampaignState());
        setLookPack(loadLookPack());
        setWatchedFirstFilm(
          loadOnboardingState().some(step => step.id === 'watch-first-film' && step.done)
        );
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(PLAY_METRICS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PLAY_METRICS_UPDATED_EVENT, refresh);
    };
  }, []);

  const rates = summarizePlayFunnel(funnel ?? undefined);
  const hasTiming = Boolean(metrics.firstPlayCampaignAt || metrics.firstFilmCutAt);
  const hasFunnel =
    (funnel?.firstPlayCampaign || 0) > 0 ||
    (funnel?.firstFilmCut || 0) > 0 ||
    (funnel?.keepTryOn || 0) > 0 ||
    (funnel?.saveToCast || 0) > 0 ||
    (funnel?.filmCutDay || 0) > 0 ||
    (funnel?.filmCutRoleplay || 0) > 0 ||
    (funnel?.campaignMaxStep || 0) > 0;
  const hasCampaign = Boolean(campaignStep?.characterId);
  const empty = !hasTiming && !hasFunnel && !hasCampaign;

  const next = resolveNextPlayAction({
    metrics,
    funnel,
    campaign: campaignStep,
    watchedFirstFilm,
    lookPack,
  });
  const stall = resolvePlayFunnelStall({
    metrics,
    funnel,
    campaign: campaignStep,
  });

  const characterId = campaignStep?.characterId?.trim() || '';
  const packForLinks =
    lookPack && characterId
      ? { ...lookPack, characterId: lookPack.characterId || characterId }
      : lookPack;

  const currentIndex = Math.max(
    campaignStep?.stepIndex ?? -1,
    (funnel?.campaignMaxStep || 0) > 0 ? (funnel?.campaignMaxStep || 1) - 1 : -1,
    0
  );
  const completed = Boolean(campaignStep?.completedAt);

  const days = daysFromCampaignStartToFirstFilmCut(metrics);
  const withinWeek = firstFilmCutWithinDays(7, metrics);
  const value =
    days === null ? (metrics.firstPlayCampaignAt ? 'Campaign started' : '—') : formatDays(days);
  const detail =
    days === null
      ? next.reason
      : withinWeek
        ? 'First film cut within a week of starting Play.'
        : 'First film cut after the first Play campaign.';

  return (
    <ToolSection
      title="Play film loop"
      description="Time and conversion from campaign start to Cut film / Save to Cast."
      data-testid="play-film-metrics"
    >
      {empty ? (
        <>
          <p className="type-caption text-[var(--text-muted)]" data-testid="play-metrics-empty">
            No Play funnel events yet. Heal & ready, queue a still, then start a campaign.
          </p>
          <div className="mt-2">
            <ButtonLink href="/play" size="sm" variant="primary" data-testid="play-empty-start">
              Open Play campaign
            </ButtonLink>
          </div>
        </>
      ) : (
        <div className="grid gap-[var(--group-gap)] sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Campaign → first film" value={value} detail={detail} />
          <StatCard
            label="First film cut"
            value={metrics.firstFilmCutAt ? 'Done' : 'Not yet'}
            detail={
              metrics.firstFilmCutAt
                ? new Date(metrics.firstFilmCutAt).toLocaleString()
                : 'Open Day or Roleplay and Cut film.'
            }
          />
          <StatCard label="Cut rate" value={formatRate(rates.cutRate)} detail={rates.headline} />
          <StatCard
            label="Save-to-Cast rate"
            value={formatRate(rates.saveRate)}
            detail={`Keep→cut ${formatRate(rates.keepToCutRate)} · ${funnel?.saveToCast ?? 0} saves`}
          />
        </div>
      )}

      <ol
        className="mt-3 flex flex-wrap gap-2"
        data-testid="play-funnel-steps"
        aria-label="Play campaign steps"
      >
        {PLAY_CAMPAIGN_STEPS.map((step, index) => {
          const done = completed || index < currentIndex;
          const isActiveStep = !completed && index === currentIndex && (hasCampaign || hasFunnel);
          const isStallStep =
            Boolean(stall) &&
            (stall!.stepId === step.id ||
              (stall!.stepId === 'cut' && (step.id === 'day' || step.id === 'roleplay')));
          const isHighlighted = isActiveStep || isStallStep;
          const chipClass = `rounded-[var(--radius-md)] border px-2.5 py-1.5 type-caption ${
            isHighlighted
              ? 'border-[var(--accent-border)] bg-[var(--accent-muted)] text-[var(--accent-text)]'
              : done
                ? 'border-[var(--tint-success-border)] text-[var(--tint-success-text)]'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
          }`;
          const label = `${index + 1}. ${step.label}`;
          const stepHref =
            characterId && step.href
              ? step.href({ characterId, pack: packForLinks })
              : resolvePlayFunnelStepHref(
                  isStallStep && stall!.stepId === 'cut' ? 'cut' : step.id,
                  characterId || undefined,
                  packForLinks
                );

          return (
            <li key={step.id}>
              <ButtonLink
                href={stepHref}
                size="sm"
                variant="ghost"
                data-testid={`play-funnel-step-${step.id}`}
                data-active={isActiveStep ? 'true' : 'false'}
                data-stall={isStallStep ? 'true' : 'false'}
                data-done={done ? 'true' : 'false'}
                className={`${chipClass} no-underline hover:no-underline`}
              >
                {label}
              </ButtonLink>
            </li>
          );
        })}
      </ol>

      {(rates.dayShare != null || rates.roleplayShare != null || rates.maxStep > 0) && (
        <p className="mt-2 type-caption text-[var(--text-muted)]" data-testid="play-funnel-source">
          Day {formatRate(rates.dayShare)} · Roleplay {formatRate(rates.roleplayShare)} · max step{' '}
          {rates.maxStep}
        </p>
      )}

      {stall ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-border)] bg-[var(--accent-muted)] px-3 py-2"
          data-testid="play-funnel-stall"
          data-stall-step={stall.stepId}
        >
          <p className="type-caption text-[var(--accent-text)]">
            Stalled at {stall.stepLabel}
            {stall.daysSinceCampaignStart != null
              ? ` · ${formatDays(stall.daysSinceCampaignStart)} since campaign start`
              : ''}
            . {stall.reason}
          </p>
          <ButtonLink
            href={resolvePlayFunnelStepHref(stall.stepId, characterId || undefined, packForLinks)}
            size="sm"
            variant="primary"
            data-testid="play-stall-cta"
          >
            {stall.stepId === 'cut'
              ? 'Cut film in Day'
              : stall.stepId === 'character'
                ? 'Open Cast'
                : `Continue ${stall.stepLabel}`}
          </ButtonLink>
        </div>
      ) : null}

      <p className="mt-2 type-caption text-[var(--text-secondary)]" data-testid="play-next-reason">
        {next.reason}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ButtonLink href={next.href} size="sm" variant="primary" data-testid="play-next-cta">
          {next.label}
        </ButtonLink>
        {next.href !== '/play' ? (
          <ButtonLink href="/play" size="sm" variant="secondary">
            Open Play campaign
          </ButtonLink>
        ) : null}
        {empty ? (
          <ButtonLink
            href="/settings?tab=comfyui&section=connection"
            size="sm"
            variant="ghost"
            data-testid="play-metrics-heal"
          >
            Heal & ready
          </ButtonLink>
        ) : null}
      </div>
    </ToolSection>
  );
}
