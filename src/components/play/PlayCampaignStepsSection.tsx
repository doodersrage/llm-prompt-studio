'use client';

import { PLAY_CAMPAIGN_STEPS } from '@/lib/play-campaign';
import { Button } from '@/components/ui/Button';
import { ToolSection } from '@/components/ui/ToolPageShell';
import type { usePlayCampaignWizardOrchestration } from '@/hooks/usePlayCampaignWizardOrchestration';

type PlayCampaignStepsSectionProps = Pick<
  ReturnType<typeof usePlayCampaignWizardOrchestration>,
  'activeStep' | 'characterId' | 'activeLookPack' | 'setStepOverride' | 'goToStep' | 'router'
>;

export default function PlayCampaignStepsSection({
  activeStep,
  characterId,
  activeLookPack,
  setStepOverride,
  goToStep,
  router,
}: PlayCampaignStepsSectionProps) {
  return (
    <ToolSection
      title="Steps"
      description="Each step carries character + look pack when staged."
      data-testid="play-campaign-steps"
    >
      <ol className="space-y-2">
        {PLAY_CAMPAIGN_STEPS.map((step, index) => {
          const isActive = step.id === activeStep;
          return (
            <li
              key={step.id}
              data-testid={`play-campaign-step-${step.id}`}
              className={`rounded-[var(--radius-md)] border px-3 py-3 ${
                isActive
                  ? 'border-[var(--accent-border)] bg-[var(--accent-muted)] shadow-[inset_3px_0_0_0_var(--accent)]'
                  : 'border-[var(--border-subtle)]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-overline mb-1 text-[var(--text-muted)]">Step {index + 1}</p>
                  <p className="type-heading">
                    {step.label}
                    {step.id === 'roleplay' ? (
                      <span className="type-caption ml-2 font-normal text-[var(--text-muted)]">
                        optional
                      </span>
                    ) : null}
                  </p>
                  <p className="type-caption text-[var(--text-muted)]">{step.description}</p>
                </div>
                <Button
                  size="sm"
                  variant={isActive ? 'primary' : 'secondary'}
                  disabled={!characterId && step.id !== 'character'}
                  onClick={() => {
                    setStepOverride(step.id);
                    if (step.id === 'character' && characterId) {
                      router.push(`/characters/${encodeURIComponent(characterId)}`);
                      return;
                    }
                    goToStep(step.id, activeLookPack);
                  }}
                >
                  Open
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </ToolSection>
  );
}
