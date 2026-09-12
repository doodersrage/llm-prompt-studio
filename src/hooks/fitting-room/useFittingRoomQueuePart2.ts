'use client';

import { useCallback, useEffect } from 'react';
import { activeLook, toggleLookKeeper } from '@/lib/character-os';
import { getCachedClothingLabel } from '@/lib/clothing-catalog-client';
import { buildFittingKitPreviewPrompt, type FittingCompareTryOn } from '@/lib/fitting-room';
import {
  countInFlightFittingKitPreviews,
  FITTING_KIT_PREVIEW_CONCURRENCY,
  FITTING_KIT_PREVIEW_HEIGHT,
  FITTING_KIT_PREVIEW_MAX,
  FITTING_KIT_PREVIEW_PROMPT_VERSION,
  FITTING_KIT_PREVIEW_WIDTH,
  fittingKitsNeedingPreview,
  getFittingKitPreview,
  upsertFittingKitPreview,
} from '@/lib/fitting-kit-previews';
import {
  applyLookPackToDaySlots,
  lookPackDayHref,
  lookPackNotes,
  loadLookPack,
  saveLookPack,
} from '@/lib/look-pack';
import { bumpPlayCampaignStep } from '@/lib/play-campaign';
import { seedDaySlotsFromKeeperWardrobes } from '@/lib/day-planner';
import { buildRoleplayQueueStillOptions } from '@/lib/roleplay-play-core';
import { DEFAULT_DAY_TOOL_CACHE, loadToolSettings, saveToolSettings } from '@/lib/settings-cache';
import type {
  FittingRoomQueueCore,
  FittingRoomQueueInput,
} from '@/hooks/fitting-room/useFittingRoomQueueCore';

export function useFittingRoomQueuePart2(input: FittingRoomQueueInput, core: FittingRoomQueueCore) {
  const {
    compareTryOns,
    previewStatus,
    setPreviewStatus,
    previewQueueBusyRef,
    kitPreviewsRef,
    queueTryOn,
  } = core;

  const queueKitPreview = useCallback(
    async (wardrobeId: string, wardrobeLabel: string) => {
      const lookId = (input.shared.activeLookId ?? input.character?.activeLookId ?? '').trim();
      if (!lookId || !input.hasReference || !wardrobeId.trim()) {
        return false;
      }
      if (input.isolateSubject && input.toolSettings.referenceIsolated !== true) {
        return false;
      }
      const existing = getFittingKitPreview(kitPreviewsRef.current, wardrobeId, lookId);
      if (
        (existing?.status === 'completed' &&
          existing.imageUrl?.trim() &&
          (existing.promptVersion ?? 0) >= FITTING_KIT_PREVIEW_PROMPT_VERSION) ||
        existing?.status === 'queued' ||
        existing?.status === 'running'
      ) {
        return false;
      }

      try {
        if (!input.previewModel) {
          input.setError(
            'Install Boogu Edit Turbo or Qwen Edit Lightning 4 for fast kit previews. Queue try-on still uses your sidebar model.'
          );
          return false;
        }
        const prompt = buildFittingKitPreviewPrompt({
          outfitLabel: wardrobeLabel.trim() || wardrobeId,
        });
        const queueOptions = buildRoleplayQueueStillOptions({
          photoMode: true,
          isolateSubject: input.isolateSubject,
          referenceIsolated: input.toolSettings.referenceIsolated === true,
          filename: input.referenceImageFilename,
          imageUrl: input.referenceImageUrl,
          identityLockStrength: input.shared.ipAdapterStrength,
          identityKind: input.shared.identityKind,
        });
        const promptId = await input.actions.sendComfyUi(prompt, undefined, undefined, {
          ...(queueOptions ?? {}),
          identityLock: false,
          queueModel: input.previewModel,
          qualityProfile: 'draft',
          queueParamsBase: input.previewQueueParams,
          ...input.previewQueueResolveOptions,
          figurePixelSize: {
            width: FITTING_KIT_PREVIEW_WIDTH,
            height: FITTING_KIT_PREVIEW_HEIGHT,
          },
          draftPreviewLite: true,
          queueHints: '',
          characterId: input.shared.activeCharacterId,
          lookId,
        });
        const next = upsertFittingKitPreview(kitPreviewsRef.current, {
          wardrobeId,
          lookId,
          promptId: typeof promptId === 'string' ? promptId.trim() : undefined,
          status: promptId ? 'queued' : 'error',
          updatedAt: Date.now(),
          promptVersion: FITTING_KIT_PREVIEW_PROMPT_VERSION,
        });
        kitPreviewsRef.current = next;
        input.updateToolSettings({ kitPreviews: next });
        return Boolean(promptId);
      } catch {
        const next = upsertFittingKitPreview(kitPreviewsRef.current, {
          wardrobeId,
          lookId,
          status: 'error',
          updatedAt: Date.now(),
        });
        kitPreviewsRef.current = next;
        input.updateToolSettings({ kitPreviews: next });
        return false;
      }
    },
    [
      input.actions,
      input.character?.activeLookId,
      input.hasReference,
      input.isolateSubject,
      input.previewModel,
      input.previewQueueParams,
      input.previewQueueResolveOptions,
      input.referenceImageFilename,
      input.referenceImageUrl,
      input.setError,
      input.shared.activeCharacterId,
      input.shared.activeLookId,
      input.shared.identityKind,
      input.shared.ipAdapterStrength,
      input.toolSettings.referenceIsolated,
      input.updateToolSettings,
      kitPreviewsRef,
    ]
  );

  const fillKitPreviews = useCallback(async () => {
    const lookId = (input.shared.activeLookId ?? input.character?.activeLookId ?? '').trim();
    if (
      !lookId ||
      !input.hasReference ||
      !input.previewModel ||
      previewQueueBusyRef.current ||
      (input.isolateSubject && input.toolSettings.referenceIsolated !== true)
    ) {
      return;
    }
    const needed = fittingKitsNeedingPreview(
      input.swipeDeck,
      kitPreviewsRef.current,
      lookId,
      FITTING_KIT_PREVIEW_MAX,
      input.deckSelectionId
    );
    if (needed.length === 0) {
      return;
    }
    const slots =
      FITTING_KIT_PREVIEW_CONCURRENCY -
      countInFlightFittingKitPreviews(kitPreviewsRef.current, lookId);
    if (slots <= 0) {
      return;
    }

    previewQueueBusyRef.current = true;
    setPreviewStatus('Queueing draft kit previews…');
    try {
      const batch = needed.slice(0, slots);
      await Promise.all(
        batch.map(wardrobeId => {
          const kit = input.swipeDeck.find(entry => entry.id === wardrobeId);
          const label = kit?.label || getCachedClothingLabel(wardrobeId) || wardrobeId;
          return queueKitPreview(wardrobeId, label);
        })
      );
      const remaining = fittingKitsNeedingPreview(
        input.swipeDeck,
        kitPreviewsRef.current,
        lookId,
        FITTING_KIT_PREVIEW_MAX,
        input.deckSelectionId
      ).length;
      setPreviewStatus(
        remaining > 0
          ? `Draft previews: ${FITTING_KIT_PREVIEW_MAX - remaining}/${FITTING_KIT_PREVIEW_MAX} queued near selection…`
          : 'Draft previews queued — thumbs fill as jobs finish.'
      );
    } finally {
      previewQueueBusyRef.current = false;
    }
  }, [
    input.character?.activeLookId,
    input.deckSelectionId,
    input.hasReference,
    input.isolateSubject,
    input.previewModel,
    input.shared.activeLookId,
    input.swipeDeck,
    input.toolSettings.referenceIsolated,
    kitPreviewsRef,
    previewQueueBusyRef,
    queueKitPreview,
    setPreviewStatus,
  ]);

  useEffect(() => {
    if (!input.mounted || !input.autoKitPreviews) {
      return;
    }
    const timer = window.setTimeout(() => {
      void fillKitPreviews();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    fillKitPreviews,
    input.activeLookId,
    input.autoKitPreviews,
    input.hasReference,
    input.inFlightPreviewCount,
    input.mounted,
    input.swipeDeck,
  ]);

  const keepTryOn = useCallback(
    (tryOn: FittingCompareTryOn) => {
      const characterId = input.shared.activeCharacterId?.trim();
      const lookId = input.shared.activeLookId ?? input.character?.activeLookId;
      const entryId = tryOn.galleryEntryId?.trim();
      if (!characterId || !lookId || !entryId) {
        input.setError('Pick a Cast character with a look before keeping a try-on.');
        return;
      }
      const updated = toggleLookKeeper(characterId, lookId, entryId);
      const wardrobeId = tryOn.wardrobeId?.trim();
      if (wardrobeId) {
        input.updateShared({ lockedWardrobeId: wardrobeId });
      }
      const existing = loadLookPack();
      const nextPack = {
        version: 1 as const,
        source: (existing?.source === 'saved' ? 'saved' : 'moodboard') as 'moodboard' | 'saved',
        characterId,
        templateId: existing?.templateId,
        paletteNotes: existing?.paletteNotes,
        lightingNotes: existing?.lightingNotes,
        locationNotes: existing?.locationNotes,
        styleNotes: existing?.styleNotes,
        moodNotes: existing?.moodNotes,
        wardrobeId: wardrobeId || existing?.wardrobeId,
        instruction: existing?.instruction,
        vibePrompt: existing?.vibePrompt,
        tileSummaries: existing?.tileSummaries,
        savedAt: Date.now(),
      };
      saveLookPack(nextPack);
      const look = updated ? activeLook(updated) : undefined;
      const keeperIds = new Set(look?.keeperEntryIds ?? [entryId]);
      const keeperWardrobes = [
        ...new Set(
          compareTryOns
            .filter(entry => entry.galleryEntryId && keeperIds.has(entry.galleryEntryId))
            .map(entry => entry.wardrobeId?.trim())
            .filter((id): id is string => Boolean(id))
        ),
      ];
      if (wardrobeId && !keeperWardrobes.includes(wardrobeId)) {
        keeperWardrobes.push(wardrobeId);
      }
      const daySettings = loadToolSettings('day', DEFAULT_DAY_TOOL_CACHE);
      const seededSlots = applyLookPackToDaySlots(
        seedDaySlotsFromKeeperWardrobes(
          daySettings.slots,
          keeperWardrobes.length > 0 ? keeperWardrobes : [wardrobeId || nextPack.wardrobeId || '']
        ),
        nextPack
      );
      saveToolSettings('day', {
        ...daySettings,
        slots: seededSlots,
        notes:
          daySettings.notes?.trim() ||
          input.toolSettings.notes?.trim() ||
          lookPackNotes(nextPack) ||
          daySettings.notes,
      });
      const dayHref = lookPackDayHref({
        ...nextPack,
        characterId,
        wardrobeId: wardrobeId || nextPack.wardrobeId,
      });
      input.setContinueDayHref(dayHref);
      bumpPlayCampaignStep({ characterId, stepId: 'day', lookPackId: undefined });
      void import('@/lib/local-observability').then(({ noteKeepTryOnMetric }) => {
        noteKeepTryOnMetric();
      });
      const kitCount = keeperWardrobes.length || 1;
      input.setSaveStatus(
        kitCount > 1
          ? `Kept ${tryOn.wardrobeLabel || tryOn.wardrobeId || 'try-on'} · ${kitCount} keeper kits mapped to Day slots.`
          : `Kept ${tryOn.wardrobeLabel || tryOn.wardrobeId || 'try-on'} as a Cast keeper · Day slots seeded.`
      );
      input.setError(null);
    },
    [
      compareTryOns,
      input.character?.activeLookId,
      input.setContinueDayHref,
      input.setError,
      input.setSaveStatus,
      input.shared.activeCharacterId,
      input.shared.activeLookId,
      input.toolSettings.notes,
      input.updateShared,
    ]
  );

  const queueTryOnAndSwipe = useCallback(async () => {
    const ok = await queueTryOn();
    if (ok) {
      input.swipeKit(1);
    }
  }, [input.swipeKit, queueTryOn]);

  return {
    queueKitPreview,
    fillKitPreviews,
    keepTryOn,
    queueTryOnAndSwipe,
    previewStatus,
  };
}
