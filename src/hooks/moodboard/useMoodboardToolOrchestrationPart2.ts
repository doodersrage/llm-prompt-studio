'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { applyCharacterRecord, addCharacterLookPack } from '@/lib/character-os';
import { loadComfyUiSettings } from '@/lib/comfyui-settings';
import { collectIsolateSourceUrls, loadImageBlobFromUrls } from '@/lib/isolate-subject';
import { sharedLlmRequestBody } from '@/lib/llm-request-options';
import {
  buildLookPackFromMoodboard,
  loadLookPack,
  lookPackDayHref,
  lookPackFittingHref,
  lookPackRoleplayHref,
  saveLookPack,
} from '@/lib/look-pack';
import { markOnboardingFirstPlayCampaign } from '@/lib/onboarding-hooks';
import { bumpPlayCampaignStep } from '@/lib/play-campaign';
import { synthesizeMoodboardPrompt } from '@/lib/moodboard-scene';
import { rememberDraftFields } from '@/lib/remember-draft-fields';
import { buildRoleplayQueueStillOptions } from '@/lib/roleplay-play-core';
import { loadSettingsCache, saveSharedSettings } from '@/lib/settings-cache';
import type { MoodboardToolOrchestrationCore } from '@/hooks/moodboard/useMoodboardToolOrchestrationCore';

const TOOL_ID = 'moodboard' as const;

export function useMoodboardToolOrchestrationPart2(ctx: MoodboardToolOrchestrationCore) {
  const router = useRouter();
  const {
    shared,
    toolSettings,
    output,
    setOutput,
    setCopied,
    setError,
    busy,
    setBusy,
    extracting,
    setExtracting,
    setLookStatus,
    tiles,
    templateId,
    character,
    plate,
    hasPlate,
    actions,
  } = ctx;

  const buildPrompt = useCallback(() => {
    return synthesizeMoodboardPrompt({
      tiles,
      templateId,
      characterName: character?.name,
      characterDescriptor: character?.descriptor || character?.hints,
      instruction: toolSettings.instruction,
    });
  }, [
    character?.descriptor,
    character?.hints,
    character?.name,
    templateId,
    tiles,
    toolSettings.instruction,
  ]);

  const queueScene = useCallback(async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    actions.resetStatuses();
    try {
      const prompt = buildPrompt();
      const finalized = await actions.finalizePrompt(prompt, character?.name || 'Moodboard scene');
      setOutput(finalized);
      rememberDraftFields({
        toolKey: TOOL_ID,
        label: 'Moodboard',
        href: '/moodboard',
        fields: [character?.name ?? '', finalized],
      });
      const queueOptions = hasPlate
        ? buildRoleplayQueueStillOptions({
            photoMode: true,
            isolateSubject: false,
            referenceIsolated: true,
            filename: plate?.filename,
            imageUrl: plate?.imageUrl,
            identityLockStrength: shared.ipAdapterStrength,
            identityKind: shared.identityKind,
          })
        : undefined;
      await actions.sendComfyUi(finalized, undefined, undefined, {
        ...(queueOptions ?? {}),
        characterId: shared.activeCharacterId,
        lookId: shared.activeLookId ?? character?.activeLookId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue that scene.');
    } finally {
      setBusy(false);
    }
  }, [
    actions,
    buildPrompt,
    character,
    hasPlate,
    plate,
    setBusy,
    setCopied,
    setError,
    setOutput,
    shared.activeCharacterId,
    shared.activeLookId,
    shared.identityKind,
    shared.ipAdapterStrength,
  ]);

  const previewPrompt = useCallback(() => {
    setError(null);
    try {
      setOutput(buildPrompt());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build prompt.');
    }
  }, [buildPrompt, setError, setOutput]);

  const blobToDataUrl = useCallback(async (blob: Blob): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read image data.'));
      reader.readAsDataURL(blob);
    });
  }, []);

  const extractLookPack = useCallback(async () => {
    setExtracting(true);
    setError(null);
    setLookStatus(null);
    try {
      if (tiles.length === 0 && !toolSettings.instruction?.trim()) {
        throw new Error('Add at least one tile or a scene instruction before extracting a look.');
      }

      let vibePrompt = '';
      const imageTiles = tiles.filter(tile => tile.imageUrl?.trim() || tile.imageFilename?.trim());
      if (imageTiles.length > 0) {
        setLookStatus('Reading reference tiles…');
        const comfyUrl = loadComfyUiSettings().apiUrl?.trim() || undefined;
        const images = await Promise.all(
          imageTiles.slice(0, 4).map(async tile => {
            const blob = await loadImageBlobFromUrls(
              collectIsolateSourceUrls({
                imageUrl: tile.imageUrl,
                filename: tile.imageFilename,
                comfyUrl,
              })
            );
            return {
              image: await blobToDataUrl(blob),
              mimeType: blob.type || 'image/jpeg',
              role: tile.role,
              focus: 'style' as const,
            };
          })
        );
        const response = await fetch('/api/image-prompt/multi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images,
            model: shared.model,
            detail: shared.detail,
            descriptionPreset: 'standard',
            extraHints: toolSettings.instruction?.trim() || undefined,
            ...sharedLlmRequestBody(shared),
          }),
        });
        const data = (await response.json()) as { prompt?: string; error?: string };
        if (!response.ok || !data.prompt?.trim()) {
          throw new Error(data.error ?? 'Could not extract a look from the board.');
        }
        vibePrompt = data.prompt.trim();
      } else {
        vibePrompt = synthesizeMoodboardPrompt({
          tiles,
          templateId,
          characterName: character?.name,
          characterDescriptor: character?.descriptor || character?.hints,
          instruction: toolSettings.instruction,
        });
      }

      const pack = buildLookPackFromMoodboard({
        tiles,
        templateId,
        characterId: character?.id ?? shared.activeCharacterId,
        instruction: toolSettings.instruction,
        vibePrompt,
        wardrobeId: shared.lockedWardrobeId,
      });
      saveLookPack(pack);
      setOutput(vibePrompt);
      setLookStatus('Look pack ready — send it to Fitting or Day.');
      return pack;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extract look pack.');
      return null;
    } finally {
      setExtracting(false);
    }
  }, [
    blobToDataUrl,
    character,
    setError,
    setExtracting,
    setLookStatus,
    setOutput,
    shared,
    templateId,
    tiles,
    toolSettings.instruction,
  ]);

  /** Prefer a staged session pack on handoff so Fitting/Day skip a second vision pass. */
  const ensureLookPackForHandoff = useCallback(async () => {
    const characterId = (character?.id ?? shared.activeCharacterId)?.trim() || undefined;
    const staged = loadLookPack();
    const reusable =
      staged &&
      Boolean(
        staged.vibePrompt?.trim() || staged.instruction?.trim() || staged.moodNotes?.trim()
      ) &&
      (!characterId || !staged.characterId || staged.characterId === characterId);
    if (reusable && staged) {
      const next = {
        ...staged,
        characterId: characterId || staged.characterId,
        wardrobeId: shared.lockedWardrobeId?.trim() || staged.wardrobeId,
      };
      saveLookPack(next);
      setLookStatus('Using staged look pack — skipped re-reading tiles.');
      return next;
    }
    return extractLookPack();
  }, [
    character?.id,
    extractLookPack,
    setLookStatus,
    shared.activeCharacterId,
    shared.lockedWardrobeId,
  ]);

  const sendLookToFitting = useCallback(async () => {
    const pack = await ensureLookPackForHandoff();
    if (!pack) {
      return;
    }
    markOnboardingFirstPlayCampaign();
    if (pack.characterId) {
      bumpPlayCampaignStep({ characterId: pack.characterId, stepId: 'fitting' });
    }
    router.push(lookPackFittingHref(pack));
  }, [ensureLookPackForHandoff, router]);

  const sendLookToDay = useCallback(async () => {
    const pack = await ensureLookPackForHandoff();
    if (!pack) {
      return;
    }
    markOnboardingFirstPlayCampaign();
    if (pack.characterId) {
      bumpPlayCampaignStep({ characterId: pack.characterId, stepId: 'day' });
    }
    router.push(lookPackDayHref(pack));
  }, [ensureLookPackForHandoff, router]);

  const sendLookToRoleplay = useCallback(async () => {
    const pack = await ensureLookPackForHandoff();
    if (!pack) {
      return;
    }
    if (pack.characterId) {
      bumpPlayCampaignStep({ characterId: pack.characterId, stepId: 'roleplay' });
    }
    router.push(lookPackRoleplayHref(pack));
  }, [ensureLookPackForHandoff, router]);

  const saveLookPackToCast = useCallback(async () => {
    const pack = await ensureLookPackForHandoff();
    if (!pack || !character) {
      if (!character) {
        setError('Pick a Cast character before saving a look pack.');
      }
      return;
    }
    const defaultName = `Look ${new Date().toLocaleDateString()}`;
    const name =
      typeof window !== 'undefined'
        ? window.prompt('Name this look pack on Cast', defaultName)?.trim() || defaultName
        : defaultName;
    addCharacterLookPack(character.id, name, pack);
    setLookStatus(`Saved "${name}" on ${character.name}.`);
    markOnboardingFirstPlayCampaign();
  }, [character, ensureLookPackForHandoff, setError, setLookStatus]);

  const goRoleplay = useCallback(() => {
    if (character) {
      saveSharedSettings({
        ...loadSettingsCache().shared,
        ...applyCharacterRecord(character),
      });
      const staged = loadLookPack();
      if (staged) {
        router.push(lookPackRoleplayHref({ ...staged, characterId: character.id }));
        return;
      }
      router.push(`/roleplay?character=${encodeURIComponent(character.id)}`);
      return;
    }
    router.push('/roleplay');
  }, [character, router]);

  return {
    queueScene,
    previewPrompt,
    extractLookPack,
    sendLookToFitting,
    sendLookToDay,
    sendLookToRoleplay,
    saveLookPackToCast,
    goRoleplay,
  };
}
