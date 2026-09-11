'use client';

import { useEffect, useState } from 'react';
import BrandMark from '@/components/BrandMark';
import BrandStudioIllustration from '@/components/BrandStudioIllustration';
import {
  WORKSPACE_MODE_OPTIONS,
  hasChosenWorkspaceMode,
  saveWorkspaceMode,
  type WorkspaceMode,
} from '@/lib/workspace-mode';
import { scheduleAfterCommit } from '@/lib/schedule-after-commit';
import { Button, ButtonLink } from '@/components/ui/Button';
import { runHealAndReady } from '@/lib/first-run-setup';
import { markOnboardingSetWorkspace } from '@/lib/onboarding-hooks';
import {
  resolveWelcomeLandingCta,
  FIRST_RUN_QUEUE_HREF,
  FIRST_RUN_GENERATE_HREF,
} from '@/lib/empty-cta';
import { useAuth } from '@/hooks/useAuth';

type WelcomePhase = 'workspace' | 'setup' | 'ready';

const PHASE_STEP: Record<WelcomePhase, number> = {
  workspace: 1,
  setup: 2,
  ready: 3,
};

/** One-time welcome: workspace density → Heal & ready → Open Generate. */
export default function WorkspaceWelcome() {
  const auth = useAuth();
  const [phase, setPhase] = useState<WelcomePhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [generateCta, setGenerateCta] = useState({
    label: 'Open Generate',
    href: '/?source=random',
  });

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PLAYWRIGHT === '1') {
      return;
    }
    if (auth?.authEnabled && !auth.user) {
      return;
    }
    scheduleAfterCommit(() => {
      if (!hasChosenWorkspaceMode()) {
        setPhase('workspace');
      }
    });
  }, [auth?.authEnabled, auth?.user]);

  if (!phase || process.env.NEXT_PUBLIC_PLAYWRIGHT === '1') {
    return null;
  }

  function choose(mode: WorkspaceMode) {
    saveWorkspaceMode(mode);
    markOnboardingSetWorkspace();
    setPhase('setup');
  }

  function finishWelcome() {
    setGenerateCta(resolveWelcomeLandingCta());
    setPhase('ready');
  }

  async function heal() {
    setBusy(true);
    setSetupMessage(null);
    try {
      const result = await runHealAndReady({
        onProgress: progress => setSetupMessage(progress.message),
      });
      setSetupMessage(result.message);
      if (result.ok || result.systemWorkflowsEnabled) {
        void import('@/lib/first-run-dismiss').then(({ dismissFirstRunSetupSurfaces }) => {
          dismissFirstRunSetupSurfaces();
        });
      }
      finishWelcome();
    } catch (err) {
      setSetupMessage(err instanceof Error ? err.message : 'Heal failed.');
    } finally {
      setBusy(false);
    }
  }

  const step = PHASE_STEP[phase];

  return (
    <div
      className="ui-overlay fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-welcome-title"
    >
      <div className="page-enter ui-welcome-card w-full max-w-lg">
        <div className="mb-5 flex items-start justify-between gap-4">
          <BrandMark
            size={36}
            withWordmark
            wordmarkClassName="type-brand type-heading tracking-tight"
          />
          <div className="ui-stepper" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(n => (
              <span
                key={n}
                className="ui-stepper-dot"
                data-active={n === step ? 'true' : 'false'}
              />
            ))}
          </div>
        </div>

        {phase === 'workspace' ? (
          <>
            <div className="mb-4 flex justify-center">
              <BrandStudioIllustration size={112} className="opacity-90" />
            </div>
            <p className="type-overline text-[var(--text-muted)]">Welcome</p>
            <h2
              id="workspace-welcome-title"
              className="type-display mt-2 text-[1.5rem] text-[var(--text-primary)]"
            >
              How do you want to work?
            </h2>
            <p className="type-body mt-2 text-[var(--text-secondary)]">
              Prompt Studio has many tools. Pick a workspace density — change anytime in the sidebar
              or Profile.
            </p>
            <div className="mt-5 grid gap-2">
              {WORKSPACE_MODE_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => choose(option.id)}
                  className="ui-choice-card"
                >
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {option.label}
                  </span>
                  <span className="type-caption mt-1 block text-[var(--text-muted)]">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => choose('play')}>
                Skip — use Play
              </Button>
            </div>
          </>
        ) : null}

        {phase === 'setup' ? (
          <>
            <p className="type-overline text-[var(--text-muted)]">Connect</p>
            <h2
              id="workspace-welcome-title"
              className="type-display mt-2 text-[1.5rem] text-[var(--text-primary)]"
            >
              Connect & ready
            </h2>
            <p className="type-body mt-2 text-[var(--text-secondary)]">
              One click enables system workflows, adapts loader maps from ComfyUI when reachable,
              and checks LLM + Comfy health. You can skip and finish later from Settings → Overview.
            </p>
            {setupMessage ? (
              <p
                className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2 type-caption text-[var(--text-muted)]"
                data-testid="welcome-heal-status"
              >
                {setupMessage}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={finishWelcome}>
                Skip for now
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                loading={busy}
                loadingLabel="Healing…"
                onClick={() => void heal()}
              >
                Heal & ready
              </Button>
            </div>
          </>
        ) : null}

        {phase === 'ready' ? (
          <>
            <p className="type-overline text-[var(--text-muted)]">Ready</p>
            <h2
              id="workspace-welcome-title"
              className="type-display mt-2 text-[1.5rem] text-[var(--text-primary)]"
            >
              You&apos;re set
            </h2>
            <p className="type-body mt-2 text-[var(--text-secondary)]">
              {setupMessage ??
                (generateCta.href.includes('/play') ||
                generateCta.href.includes('/day') ||
                generateCta.href.includes('/characters')
                  ? 'Pick up your Play film loop, or Generate anytime from All tools.'
                  : generateCta.href.startsWith('/roleplay')
                    ? 'Open Roleplay to start a story loop, or Generate anytime from All tools.'
                    : 'Queue a first still (Random surprise needs no keywords), then start a Play campaign for Moodboard → film.')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhase(null)}>
                Close
              </Button>
              {generateCta.href === FIRST_RUN_GENERATE_HREF ||
              generateCta.href.startsWith('/?source=random') ? (
                <ButtonLink
                  href="/play"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    saveWorkspaceMode('play');
                    setPhase(null);
                  }}
                >
                  Start Play campaign
                </ButtonLink>
              ) : null}
              {generateCta.href.startsWith('/roleplay') ||
              generateCta.href.includes('/play') ||
              generateCta.href.includes('/day') ||
              generateCta.href.includes('/characters') ||
              generateCta.href.includes('/fitting') ||
              generateCta.href.includes('/moodboard') ? null : (
                <ButtonLink
                  href={generateCta.href}
                  variant="secondary"
                  size="sm"
                  onClick={() => setPhase(null)}
                >
                  {generateCta.label}
                </ButtonLink>
              )}
              <ButtonLink
                href={
                  generateCta.href.startsWith('/roleplay') ||
                  generateCta.href.includes('/play') ||
                  generateCta.href.includes('/day') ||
                  generateCta.href.includes('/characters') ||
                  generateCta.href.includes('/fitting') ||
                  generateCta.href.includes('/moodboard')
                    ? generateCta.href
                    : FIRST_RUN_QUEUE_HREF
                }
                variant="primary"
                size="sm"
                onClick={() => setPhase(null)}
              >
                {generateCta.href.startsWith('/roleplay') ||
                generateCta.href.includes('/play') ||
                generateCta.href.includes('/day') ||
                generateCta.href.includes('/characters') ||
                generateCta.href.includes('/fitting') ||
                generateCta.href.includes('/moodboard')
                  ? generateCta.label
                  : 'Generate & queue first scene'}
              </ButtonLink>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
