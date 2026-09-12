'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCachedSettings } from '@/hooks/useCachedSettings';
import {
  addCharacterLookPack,
  applyCharacterRecord,
  applyCharacterRecordFresh,
  characterFromShared,
  createBlankCharacter,
  getCharacter,
  getCharacterLookPack,
  lookPacksOf,
  upsertCharacter,
} from '@/lib/character-os';
import {
  clearLookPack,
  clearLookPackShareHash,
  loadLookPack,
  buildPortableLookPackShareLink,
  readPortableLookPackFromHash,
  saveLookPack,
  type LookPack,
} from '@/lib/look-pack';
import { markOnboardingFirstPlayCampaign } from '@/lib/onboarding-hooks';
import {
  clearPlayCampaignState,
  loadPlayCampaignState,
  PLAY_CAMPAIGN_STEPS,
  playCampaignHref,
  resolveCampaignLookPackId,
  savePlayCampaignState,
  stagePlayCampaignHandoff,
  type PlayCampaignStepId,
} from '@/lib/play-campaign';
import { CHARACTERS_UPDATED_EVENT } from '@/lib/character-os';
import {
  loadSettingsCache,
  saveSharedSettings,
  saveToolSettings,
  DEFAULT_MOODBOARD_TOOL_CACHE,
  DEFAULT_ROLEPLAY_TOOL_CACHE,
} from '@/lib/settings-cache';
import { scheduleAfterCommit } from '@/lib/schedule-after-commit';

export type PlayCampaignWizardProps = {
  initialCharacterId?: string;
};

export function usePlayCampaignWizardOrchestration({
  initialCharacterId,
}: PlayCampaignWizardProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mounted, shared, updateShared } = useCachedSettings(
    'roleplay',
    DEFAULT_ROLEPLAY_TOOL_CACHE
  );
  const [status, setStatus] = useState<string | null>(null);
  const [shareCopyStatus, setShareCopyStatus] = useState<string | null>(null);
  const [stepOverride, setStepOverride] = useState<PlayCampaignStepId | null>(null);
  const lookPackFileRef = useRef<HTMLInputElement | null>(null);
  const [charactersRevision, setCharactersRevision] = useState(0);

  useEffect(() => {
    const onCharactersUpdated = () => setCharactersRevision(revision => revision + 1);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, onCharactersUpdated);
    return () => window.removeEventListener(CHARACTERS_UPDATED_EVENT, onCharactersUpdated);
  }, []);

  const queryCharacterId = searchParams.get('character')?.trim() || '';
  const queryLookPackId = searchParams.get('lookPack')?.trim() || '';
  const characterId = (
    initialCharacterId ||
    queryCharacterId ||
    shared.activeCharacterId ||
    ''
  ).trim();
  const character = characterId ? getCharacter(characterId) : undefined;

  const durableCampaign = useMemo(() => {
    if (!mounted) {
      return null;
    }
    const saved = loadPlayCampaignState();
    if (!saved || saved.stepIndex <= 0) {
      return null;
    }
    return saved;
  }, [mounted]);

  const campaignCharacterMismatch = Boolean(
    durableCampaign && characterId && durableCampaign.characterId !== characterId
  );

  const savedCampaign =
    durableCampaign && characterId && durableCampaign.characterId === characterId
      ? durableCampaign
      : null;

  const effectiveLookPackId =
    resolveCampaignLookPackId({
      queryLookPackId,
      savedLookPackId: savedCampaign?.lookPackId ?? durableCampaign?.lookPackId,
    }) ?? '';

  const restoredStep = useMemo((): PlayCampaignStepId | null => {
    if (!mounted || !savedCampaign) {
      return null;
    }
    return PLAY_CAMPAIGN_STEPS[savedCampaign.stepIndex]?.id ?? 'character';
  }, [mounted, savedCampaign]);

  const activeStep = stepOverride ?? restoredStep ?? 'character';

  const resumeStep = savedCampaign ? (PLAY_CAMPAIGN_STEPS[savedCampaign.stepIndex] ?? null) : null;
  const campaignComplete = Boolean(savedCampaign?.completedAt);

  const savedLookPacks = useMemo(() => (character ? lookPacksOf(character) : []), [character]);

  const activeLookPack = useMemo((): LookPack | null => {
    if (effectiveLookPackId && character) {
      return getCharacterLookPack(character.id, effectiveLookPackId)?.pack ?? null;
    }
    return loadLookPack() ?? null;
  }, [character, effectiveLookPackId]);

  const portableShareLink = useMemo(() => {
    if (!activeLookPack) {
      return null;
    }
    return buildPortableLookPackShareLink({
      pack: activeLookPack,
      name: character?.name,
      id: effectiveLookPackId || undefined,
    });
  }, [activeLookPack, character?.name, effectiveLookPackId]);

  const persistCharacter = useCallback(
    (id: string) => {
      const record = getCharacter(id);
      if (!record) {
        return;
      }
      saveSharedSettings({
        ...loadSettingsCache().shared,
        ...applyCharacterRecord(record),
      });
      updateShared(applyCharacterRecord(record));
    },
    [updateShared]
  );

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const portable = readPortableLookPackFromHash();
    if (!portable) {
      return;
    }
    clearLookPackShareHash();
    scheduleAfterCommit(() => {
      if (!character) {
        const defaultName =
          portable.name?.trim() || portable.pack.characterId?.trim() || 'Imported look';
        const name =
          typeof window !== 'undefined'
            ? window
                .prompt('Name the new Cast character for this look pack', defaultName)
                ?.trim() || defaultName
            : defaultName;
        const createdList = upsertCharacter(
          characterFromShared(loadSettingsCache().shared, { name })
        );
        const record = createdList.at(-1) ?? getCharacter(createdList[0]?.id ?? '');
        if (!record) {
          saveLookPack(portable.pack);
          setStatus('Look pack staged — could not create a Cast character.');
          return;
        }
        const withPack = addCharacterLookPack(record.id, portable.name || 'Imported look', {
          ...portable.pack,
          characterId: record.id,
          source: 'saved',
        });
        const entry = withPack ? lookPacksOf(withPack)[0] : undefined;
        persistCharacter(record.id);
        saveLookPack({
          ...portable.pack,
          characterId: record.id,
          source: 'saved',
        });
        if (entry) {
          router.replace(
            `/play?character=${encodeURIComponent(record.id)}&lookPack=${encodeURIComponent(entry.id)}`
          );
        } else {
          router.replace(`/play?character=${encodeURIComponent(record.id)}`);
        }
        setStatus(`Created Cast "${record.name}" from share link.`);
        return;
      }
      const saved = addCharacterLookPack(character.id, portable.name || 'Shared look', {
        ...portable.pack,
        characterId: character.id,
        source: 'saved',
      });
      const entry = saved ? lookPacksOf(saved)[0] : undefined;
      saveLookPack({ ...portable.pack, characterId: character.id, source: 'saved' });
      if (entry) {
        router.replace(
          `/play?character=${encodeURIComponent(character.id)}&lookPack=${encodeURIComponent(entry.id)}`
        );
      }
      setStatus(`Imported shared look pack onto ${character.name}.`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !savedCampaign || !characterId) {
      return;
    }
    const packId = savedCampaign.lookPackId?.trim();
    if (!packId || queryLookPackId) {
      return;
    }
    router.replace(playCampaignHref(characterId, packId));
    const characterRecord = getCharacter(characterId);
    if (!characterRecord) {
      return;
    }
    const saved = getCharacterLookPack(characterRecord.id, packId);
    if (!saved) {
      return;
    }
    saveLookPack({ ...saved.pack, characterId: characterRecord.id, source: 'saved' });
  }, [
    mounted,
    savedCampaign,
    characterId,
    queryLookPackId,
    router,
    charactersRevision,
    savedLookPacks.length,
  ]);

  const goToStep = useCallback(
    (stepId: PlayCampaignStepId, pack?: LookPack | null) => {
      if (!characterId) {
        setStatus('Pick a Cast character first.');
        return;
      }
      persistCharacter(characterId);
      const stepIndex = PLAY_CAMPAIGN_STEPS.findIndex(entry => entry.id === stepId);
      savePlayCampaignState({
        version: 1,
        characterId,
        lookPackId: effectiveLookPackId || undefined,
        stepIndex: stepIndex >= 0 ? stepIndex : 0,
        updatedAt: Date.now(),
      });
      if (stepId !== 'character') {
        markOnboardingFirstPlayCampaign();
        void import('@/lib/local-observability').then(
          ({ noteCampaignStepMetric, noteCampaignMaxStepMetric }) => {
            noteCampaignStepMetric();
            noteCampaignMaxStepMetric(stepIndex >= 0 ? stepIndex : 0);
          }
        );
      }
      const handoff = pack ?? activeLookPack;
      if (handoff && stepId !== 'character' && stepId !== 'moodboard') {
        stagePlayCampaignHandoff({ ...handoff, characterId });
      }
      const step = PLAY_CAMPAIGN_STEPS.find(entry => entry.id === stepId);
      if (!step) {
        return;
      }
      router.push(step.href({ characterId, pack: handoff }));
    },
    [activeLookPack, characterId, effectiveLookPackId, persistCharacter, router]
  );

  const startNewCampaign = useCallback(() => {
    if (!characterId) {
      setStatus('Pick a Cast character first.');
      return;
    }
    void import('@/lib/onboarding-hooks').then(({ markOnboardingWatchFirstFilm }) => {
      markOnboardingWatchFirstFilm();
    });
    clearPlayCampaignState();
    setStepOverride(null);
    goToStep('moodboard', activeLookPack);
  }, [activeLookPack, characterId, goToStep]);

  const createCharacter = useCallback(
    (input: { name: string; continueToMoodboard?: boolean }) => {
      const name = input.name.trim() || 'Untitled character';
      const record = createBlankCharacter(name);
      upsertCharacter(record);
      const saved = getCharacter(record.id) ?? record;
      // Drop the previous Cast's face lock / wardrobe / look pack / Moodboard tiles.
      clearLookPack();
      saveToolSettings('moodboard', { ...DEFAULT_MOODBOARD_TOOL_CACHE });
      const patch = applyCharacterRecordFresh(saved);
      saveSharedSettings({
        ...loadSettingsCache().shared,
        ...patch,
      });
      updateShared(patch);
      const moodboardIndex = PLAY_CAMPAIGN_STEPS.findIndex(entry => entry.id === 'moodboard');
      const continueToMoodboard = input.continueToMoodboard === true;
      savePlayCampaignState({
        version: 1,
        characterId: saved.id,
        stepIndex: continueToMoodboard && moodboardIndex >= 0 ? moodboardIndex : 0,
        updatedAt: Date.now(),
      });
      if (continueToMoodboard) {
        markOnboardingFirstPlayCampaign();
        void import('@/lib/local-observability').then(
          ({ noteCampaignStepMetric, noteCampaignMaxStepMetric }) => {
            noteCampaignStepMetric();
            noteCampaignMaxStepMetric(moodboardIndex >= 0 ? moodboardIndex : 0);
          }
        );
        setStepOverride('moodboard');
        setStatus(`Created "${saved.name}" — opening Moodboard.`);
        router.push(`/moodboard?character=${encodeURIComponent(saved.id)}`);
        return;
      }
      setStepOverride('character');
      setStatus(`Created "${saved.name}". Continue to Moodboard when ready.`);
      router.replace(`/play?character=${encodeURIComponent(saved.id)}`);
    },
    [router, updateShared]
  );

  const applySavedLookPack = useCallback(
    (lookPackId: string) => {
      if (!character) {
        return;
      }
      const saved = getCharacterLookPack(character.id, lookPackId);
      if (!saved) {
        setStatus('That look pack is no longer on this character.');
        return;
      }
      saveLookPack(saved.pack);
      scheduleAfterCommit(() => setStatus(`Loaded "${saved.name}" — continue to Fitting or Day.`));
      router.replace(
        `/play?character=${encodeURIComponent(character.id)}&lookPack=${encodeURIComponent(saved.id)}`
      );
    },
    [character, router]
  );

  return {
    mounted,
    shared,
    updateShared,
    status,
    setStatus,
    shareCopyStatus,
    setShareCopyStatus,
    stepOverride,
    setStepOverride,
    lookPackFileRef,
    characterId,
    character,
    durableCampaign,
    campaignCharacterMismatch,
    savedCampaign,
    effectiveLookPackId,
    activeStep,
    resumeStep,
    campaignComplete,
    savedLookPacks,
    activeLookPack,
    portableShareLink,
    persistCharacter,
    createCharacter,
    goToStep,
    startNewCampaign,
    applySavedLookPack,
    router,
  };
}
