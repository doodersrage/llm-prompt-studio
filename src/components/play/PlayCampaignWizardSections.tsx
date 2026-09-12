'use client';

import { ToolBadge, ToolLayout } from '@/components/ui/ToolPageShell';
import PlayCampaignCharacterSection from '@/components/play/PlayCampaignCharacterSection';
import PlayCampaignShareLookPackSection from '@/components/play/PlayCampaignShareLookPackSection';
import PlayCampaignSavedLookPacksSection from '@/components/play/PlayCampaignSavedLookPacksSection';
import PlayCampaignStepsSection from '@/components/play/PlayCampaignStepsSection';
import PlayCampaignActionsSection from '@/components/play/PlayCampaignActionsSection';
import type { usePlayCampaignWizardOrchestration } from '@/hooks/usePlayCampaignWizardOrchestration';

const ACCENT = 'amber' as const;

type PlayCampaignWizardViewModel = ReturnType<typeof usePlayCampaignWizardOrchestration>;

export default function PlayCampaignWizardSections(props: PlayCampaignWizardViewModel) {
  return (
    <div data-testid="play-campaign">
      <ToolLayout
        accent={ACCENT}
        badge={<ToolBadge accent={ACCENT}>Play campaign</ToolBadge>}
        title="Play campaign"
        description="Create a Cast character, then one guided loop: Moodboard → Fitting → Day → optional Roleplay."
      >
        <PlayCampaignCharacterSection
          shared={props.shared}
          updateShared={props.updateShared}
          character={props.character}
          activeLookPack={props.activeLookPack}
          persistCharacter={props.persistCharacter}
          createCharacter={props.createCharacter}
          setStatus={props.setStatus}
        />
        <PlayCampaignShareLookPackSection
          lookPackFileRef={props.lookPackFileRef}
          character={props.character}
          characterId={props.characterId}
          activeLookPack={props.activeLookPack}
          effectiveLookPackId={props.effectiveLookPackId}
          portableShareLink={props.portableShareLink}
          shareCopyStatus={props.shareCopyStatus}
          setShareCopyStatus={props.setShareCopyStatus}
          setStatus={props.setStatus}
          persistCharacter={props.persistCharacter}
          router={props.router}
        />
        <PlayCampaignSavedLookPacksSection
          savedLookPacks={props.savedLookPacks}
          applySavedLookPack={props.applySavedLookPack}
        />
        <PlayCampaignStepsSection
          activeStep={props.activeStep}
          characterId={props.characterId}
          activeLookPack={props.activeLookPack}
          setStepOverride={props.setStepOverride}
          goToStep={props.goToStep}
          router={props.router}
        />
        <PlayCampaignActionsSection
          status={props.status}
          durableCampaign={props.durableCampaign}
          campaignCharacterMismatch={props.campaignCharacterMismatch}
          savedCampaign={props.savedCampaign}
          campaignComplete={props.campaignComplete}
          characterId={props.characterId}
          resumeStep={props.resumeStep}
          activeLookPack={props.activeLookPack}
          goToStep={props.goToStep}
          startNewCampaign={props.startNewCampaign}
        />
      </ToolLayout>
    </div>
  );
}
