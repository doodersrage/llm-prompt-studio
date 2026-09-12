'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCachedSettings } from '@/hooks/useCachedSettings';
import { useWorkspaceMode } from '@/hooks/useWorkspaceMode';
import { isLeanWorkspaceMode } from '@/lib/workspace-mode';
import { usePromptResultActions } from '@/hooks/usePromptResultActions';
import { useSeedToolDraft } from '@/hooks/useSeedToolDraft';
import { parseCharacterHints } from '@/lib/character-hints';
import {
  assembleAndStampFilm,
  downloadFilmBlob,
  stampAssembledFilm,
} from '@/lib/character-film-assemble';
import { filmDownloadFilename } from '@/lib/character-film';
import { applyCharacterRecord, getCharacter, upsertCharacter } from '@/lib/character-os';
import {
  markOnboardingFirstFilmCut,
  markOnboardingFirstPlayCampaign,
} from '@/lib/onboarding-hooks';
import { subjectGenderToClothingGender } from '@/lib/clothing-gender';
import {
  fetchClothingLabels,
  fetchClothingSelectOptions,
  getCachedClothingLabel,
} from '@/lib/clothing-catalog-client';
import { getComfyModelDefinition } from '@/lib/comfy-models/client';
import {
  COMFYUI_GALLERY_UPDATED_EVENT,
  galleryEntryPrimaryViewUrl,
  loadComfyGallery,
} from '@/lib/comfyui-gallery';
import {
  buildDaySlotMotionSubject,
  buildDaySlotPrompt,
  dayWatchPlaylist,
  mergeDaySlotStills,
  normalizeDaySlotStills,
  normalizeDaySlots,
  seedDaySlotsWardrobe,
  upsertDaySlotStill,
  type DaySlot,
  type DaySlotId,
} from '@/lib/day-planner';
import { resolveFittingPlateFromCharacter } from '@/lib/fitting-room';
import {
  countWardrobeOptionsForFilter,
  filterWardrobeSelectOptions,
  normalizeWardrobeCategoryFilter,
} from '@/lib/wardrobe-catalog-ui';
import {
  applyLookPackToDaySlots,
  loadLookPack,
  lookPackNotes,
  lookPackRoleplayHref,
  saveLookPack,
} from '@/lib/look-pack';
import { bumpPlayCampaignStep, completePlayCampaign } from '@/lib/play-campaign';
import { getReformatTargetModel } from '@/lib/reformat-target';
import { rememberDraftFields } from '@/lib/remember-draft-fields';
import { buildRoleplayQueueStillOptions } from '@/lib/roleplay-play-core';
import { isGalleryClipEntry } from '@/lib/roleplay-film';
import { resolvePreferredVideoModel } from '@/lib/queue-tool-model';
import { scheduleAfterCommit } from '@/lib/schedule-after-commit';
import { resolveFilmFailurePlaybook } from '@/lib/queue-failure-playbook';
import {
  DEFAULT_DAY_TOOL_CACHE,
  DEFAULT_VIDEO_TOOL_CACHE,
  loadSettingsCache,
  loadToolSettings,
  saveSharedSettings,
} from '@/lib/settings-cache';

const TOOL_ID = 'day' as const;
type ClothingOption = { value: string; label: string; group?: string };

import type { DayPlannerToolOrchestrationCore } from '@/hooks/day-planner/useDayPlannerToolOrchestrationCore';

export function useDayPlannerToolOrchestrationPart2(ctx: DayPlannerToolOrchestrationCore) {
  const {
    router,
    setBusy,
    setAssemblingFilm,
    setFilmStatus,
    setFilmNeedsCast,
    stillsRef,
    assembledFilmRef,
    buildSlotPrompt,
    mounted,
    shared,
    toolSettings,
    updateShared,
    updateToolSettings,
    output,
    setOutput,
    copied,
    setCopied,
    error,
    setError,
    setFilmGuideHref,
    busy,
    activeSlotId,
    setActiveSlotId,
    wardrobeLabels,
    assemblingFilm,
    filmStatus,
    filmNeedsCast,
    slots,
    stills,
    watchPlaylist,
    activeSlot,
    character,
    selectedModel,
    plate,
    hasPlate,
    wardrobeOptions,
    wardrobeReady,
    wardrobeCategoryFilter,
    filteredWardrobeOptions,
    wardrobeKitCount,
    actions,
    updateSlot,
    wardrobeLabelFor,
    queueSlot,
    leanChrome,
  } = ctx;

  const queueAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Parallel submit — each slot updates stillsRef synchronously after await.
      await Promise.all(slots.map(slot => queueSlot(slot, { manageBusy: false })));
    } finally {
      setBusy(false);
    }
  }, [queueSlot, slots]);

  const animateSlot = useCallback(
    async (slot: DaySlot, options?: { manageBusy?: boolean }) => {
      const manageBusy = options?.manageBusy !== false;
      const still = stillsRef.current.find(entry => entry.slotId === slot.id);
      const imageUrl = still?.status === 'completed' ? still.imageUrl?.trim() : '';
      if (!imageUrl) {
        setError(`Queue and wait for the ${slot.label.toLowerCase()} still before animating.`);
        return;
      }
      if (manageBusy) {
        setBusy(true);
      }
      setError(null);
      setActiveSlotId(slot.id);
      actions.resetStatuses();
      try {
        const parentEntry = still?.promptId
          ? loadComfyGallery().find(entry => entry.promptId === still.promptId)
          : undefined;
        const videoModel = resolvePreferredVideoModel({
          toolModel: loadToolSettings('video', DEFAULT_VIDEO_TOOL_CACHE).model,
          sharedModel: shared.model,
        });
        const subject = buildDaySlotMotionSubject(slot, character?.name);
        let prompt = subject;
        try {
          const response = await fetch('/api/video-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: slot.label,
              motion: slot.sceneHints?.trim() || subject,
              model: videoModel,
              durationSec: 4,
            }),
          });
          const data = (await response.json()) as { prompt?: string };
          if (data.prompt?.trim()) {
            prompt = data.prompt.trim();
          }
        } catch {
          /* use subject */
        }
        const promptId = await actions.sendComfyUi(prompt, undefined, undefined, {
          queueTool: 'video',
          queueModel: videoModel,
          inputImageUrl: imageUrl,
          parentGalleryEntryId: parentEntry?.id,
          derivedKind: 'i2v',
          clipMode: 'i2v',
          qualityProfile: 'final',
          queueParamsBase: { videoFrames: 64, videoFps: 16 },
          characterId: shared.activeCharacterId,
          lookId: shared.activeLookId ?? character?.activeLookId,
        });
        const nextStills = upsertDaySlotStill(stillsRef.current, {
          slotId: slot.id,
          clipPromptId: typeof promptId === 'string' ? promptId : undefined,
          clipStatus: promptId ? 'queued' : 'error',
          clipUrl: undefined,
        });
        stillsRef.current = nextStills;
        updateToolSettings({ stills: nextStills });
        if (promptId) {
          setFilmStatus(
            `Queued ${slot.label.toLowerCase()} clip — motion reel prefers clips when ready.`
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not queue that clip.');
        const nextStills = upsertDaySlotStill(stillsRef.current, {
          slotId: slot.id,
          clipStatus: 'error',
        });
        stillsRef.current = nextStills;
        updateToolSettings({ stills: nextStills });
      } finally {
        if (manageBusy) {
          setBusy(false);
        }
      }
    },
    [
      actions,
      character,
      shared.activeCharacterId,
      shared.activeLookId,
      shared.model,
      updateToolSettings,
    ]
  );

  const animateAllClips = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const pending = slots.filter(slot => {
        const still = stillsRef.current.find(entry => entry.slotId === slot.id);
        return still?.status === 'completed' && still.clipStatus !== 'completed';
      });
      await Promise.all(pending.map(slot => animateSlot(slot, { manageBusy: false })));
    } finally {
      setBusy(false);
    }
  }, [animateSlot, slots]);

  const cutDayFilm = useCallback(async () => {
    const shots = dayWatchPlaylist(stillsRef.current, slots);
    if (shots.length === 0) {
      setFilmGuideHref(null);
      setError('Queue and wait for at least one completed slot still before cutting a film.');
      return;
    }
    const name = character?.name?.trim() || 'day';
    setAssemblingFilm(true);
    setError(null);
    setFilmGuideHref(null);
    setFilmNeedsCast(false);
    setFilmStatus('Checking shots…');
    try {
      const result = await assembleAndStampFilm({
        shots,
        characterId: character?.id ?? '',
        characterName: name,
        lookId: character?.activeLookId ?? shared.activeLookId,
        onProgress: progress => setFilmStatus(progress.label),
      });
      downloadFilmBlob(result.blob, result.filename);
      assembledFilmRef.current = {
        filename: result.filename,
        data: new Uint8Array(await result.blob.arrayBuffer()),
      };
      if (character && result.persisted) {
        setFilmNeedsCast(false);
        setFilmStatus(
          `Saved ${result.filename} to ${character.name} (${result.encodePath} encode) and started the download.`
        );
      } else {
        setFilmNeedsCast(true);
        setFilmStatus(
          character
            ? `Downloaded ${result.filename} (${result.encodePath} encode). Save to Cast to stamp a studio copy.`
            : `Downloaded ${result.filename} (${result.encodePath} encode) unstamped. Save to Cast to attach this film.`
        );
      }
      markOnboardingFirstPlayCampaign();
      markOnboardingFirstFilmCut();
      void import('@/lib/local-observability').then(
        ({ noteFilmCutSourceMetric, noteSaveToCastMetric }) => {
          noteFilmCutSourceMetric('day');
          if (character && result.persisted) {
            noteSaveToCastMetric();
          }
        }
      );
      if (character) {
        completePlayCampaign({ characterId: character.id, stepId: 'day' });
      }
    } catch (err) {
      const playbook = resolveFilmFailurePlaybook(
        err instanceof Error ? err.message : 'Could not assemble the film.'
      );
      setError(playbook.message);
      setFilmGuideHref(playbook.href ?? null);
      setFilmStatus(null);
    } finally {
      setAssemblingFilm(false);
    }
  }, [character, shared.activeLookId, setFilmGuideHref, slots]);

  const saveFilmToCast = useCallback(() => {
    if (!character) {
      setError('Pick a Cast character before saving the day film.');
      return;
    }
    const film = assembledFilmRef.current;
    upsertCharacter({
      ...character,
      name: character.name,
    });
    const next = getCharacter(character.id) ?? character;
    saveSharedSettings({
      ...loadSettingsCache().shared,
      ...applyCharacterRecord(next),
    });
    void import('@/lib/local-observability').then(({ noteSaveToCastMetric }) => {
      noteSaveToCastMetric();
    });
    if (!film) {
      setFilmNeedsCast(false);
      setFilmStatus(`Saved ${next.name} to Cast.`);
      return;
    }
    void (async () => {
      const stamped = await stampAssembledFilm({
        blob: new Blob([film.data.slice()]),
        filename: film.filename || filmDownloadFilename(next.name),
        characterId: next.id,
        characterName: next.name,
        lookId: next.activeLookId,
      });
      setFilmNeedsCast(false);
      setFilmStatus(
        stamped.persisted
          ? `Saved ${next.name} to Cast and stamped ${film.filename}.`
          : `Saved ${next.name} to Cast. Studio storage could not keep the film.`
      );
    })();
  }, [character]);

  const goRoleplay = useCallback(() => {
    if (character) {
      saveSharedSettings({
        ...loadSettingsCache().shared,
        ...applyCharacterRecord(character),
      });
      bumpPlayCampaignStep({ characterId: character.id, stepId: 'roleplay' });
      const pack = loadLookPack();
      if (pack) {
        const staged = { ...pack, characterId: character.id };
        saveLookPack(staged);
        router.push(lookPackRoleplayHref(staged));
        return;
      }
      router.push(`/roleplay?character=${encodeURIComponent(character.id)}`);
      return;
    }
    router.push('/roleplay');
  }, [character, router]);

  const completedShotCount = watchPlaylist.length;
  const fittingWardrobe = (activeSlot.wardrobeId || shared.lockedWardrobeId || '').trim();

  return {
    queueAll,
    animateSlot,
    animateAllClips,
    cutDayFilm,
    saveFilmToCast,
    goRoleplay,
    completedShotCount,
    fittingWardrobe,
  };
}
