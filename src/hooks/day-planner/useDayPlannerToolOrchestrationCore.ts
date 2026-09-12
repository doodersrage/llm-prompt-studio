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
import {
  DEFAULT_DAY_TOOL_CACHE,
  DEFAULT_VIDEO_TOOL_CACHE,
  loadSettingsCache,
  loadToolSettings,
  saveSharedSettings,
} from '@/lib/settings-cache';

const TOOL_ID = 'day' as const;
type ClothingOption = { value: string; label: string; group?: string };

export function useDayPlannerToolOrchestrationCore() {
  const router = useRouter();
  const workspaceMode = useWorkspaceMode();
  const leanChrome = isLeanWorkspaceMode(workspaceMode);
  const { mounted, shared, toolSettings, updateShared, updateToolSettings } = useCachedSettings(
    'day',
    DEFAULT_DAY_TOOL_CACHE
  );

  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filmGuideHref, setFilmGuideHref] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeSlotId, setActiveSlotId] = useState<DaySlotId>('morning');
  const [wardrobeLabels, setWardrobeLabels] = useState<Record<string, string>>({});
  const [assemblingFilm, setAssemblingFilm] = useState(false);
  const [filmStatus, setFilmStatus] = useState<string | null>(null);
  const [filmNeedsCast, setFilmNeedsCast] = useState(false);
  const assembledFilmRef = useRef<{ filename: string; data: Uint8Array } | null>(null);
  const deepLinkHandled = useRef(false);
  const stillsRef = useRef(normalizeDaySlotStills(toolSettings.stills));

  const slots = useMemo(() => normalizeDaySlots(toolSettings.slots), [toolSettings.slots]);
  const stills = useMemo(() => normalizeDaySlotStills(toolSettings.stills), [toolSettings.stills]);
  stillsRef.current = stills;
  const watchPlaylist = useMemo(() => dayWatchPlaylist(stills, slots), [slots, stills]);
  const activeSlot = slots.find(slot => slot.id === activeSlotId) ?? slots[0]!;
  const character = getCharacter(shared.activeCharacterId);
  const selectedModel = getComfyModelDefinition(shared.model);
  const plate = useMemo(() => resolveFittingPlateFromCharacter(character), [character]);
  const hasPlate = Boolean(plate?.filename || plate?.imageUrl);

  const clothingGender = useMemo(
    () =>
      subjectGenderToClothingGender(
        parseCharacterHints(character?.hints || character?.descriptor).gender
      ),
    [character?.descriptor, character?.hints]
  );

  const [wardrobeOptions, setWardrobeOptions] = useState<ClothingOption[]>([
    { value: '', label: 'Default kit…' },
  ]);
  const [wardrobeLoadedKey, setWardrobeLoadedKey] = useState<string | null>(null);
  const wardrobeOptionsKey = `wardrobeCatalog:${clothingGender}`;
  const wardrobeReady = wardrobeLoadedKey === wardrobeOptionsKey;
  const wardrobeCategoryFilter = normalizeWardrobeCategoryFilter(
    toolSettings.wardrobeCategoryFilter
  );
  const filteredWardrobeOptions = useMemo(
    () =>
      filterWardrobeSelectOptions(
        wardrobeOptions,
        wardrobeCategoryFilter,
        activeSlot.wardrobeId || shared.lockedWardrobeId
      ),
    [activeSlot.wardrobeId, shared.lockedWardrobeId, wardrobeCategoryFilter, wardrobeOptions]
  );
  const wardrobeKitCount = useMemo(
    () => countWardrobeOptionsForFilter(wardrobeOptions, wardrobeCategoryFilter),
    [wardrobeCategoryFilter, wardrobeOptions]
  );

  useSeedToolDraft(mounted, {
    toolKey: TOOL_ID,
    label: 'Day Planner',
    href: '/day',
    fields: [character?.name, activeSlot.sceneHints, toolSettings.notes],
  });

  const actions = usePromptResultActions({
    tool: TOOL_ID,
    model: shared.model,
    detail: shared.detail,
    hints: toolSettings.notes,
    autoFixRules: shared.autoFixRules !== false,
    reformatTarget: getReformatTargetModel(shared.model),
  });

  const updateSlot = useCallback(
    (slotId: DaySlotId, patch: Partial<DaySlot>) => {
      updateToolSettings({
        slots: slots.map(slot => (slot.id === slotId ? { ...slot, ...patch } : slot)),
      });
    },
    [slots, updateToolSettings]
  );

  useEffect(() => {
    if (!mounted || typeof window === 'undefined' || deepLinkHandled.current) {
      return;
    }
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const characterId = params.get('character')?.trim();
    const wardrobeId = params.get('wardrobe')?.trim();
    const fromLook = params.get('from')?.trim() === 'look';

    if (characterId) {
      const record = getCharacter(characterId);
      if (record) {
        try {
          updateShared(applyCharacterRecord(record));
        } catch (err) {
          scheduleAfterCommit(() =>
            setError(err instanceof Error ? err.message : 'Could not apply that character.')
          );
        }
      }
    }
    if (wardrobeId) {
      updateShared({ lockedWardrobeId: wardrobeId });
      updateToolSettings({
        slots: seedDaySlotsWardrobe(toolSettings.slots, wardrobeId),
      });
    }
    if (fromLook) {
      // Keep the session pack for Roleplay handoff; Roleplay clears on apply.
      const pack = loadLookPack();
      if (pack) {
        if (pack.wardrobeId?.trim() && !wardrobeId) {
          updateShared({ lockedWardrobeId: pack.wardrobeId.trim() });
        }
        const nextSlots = applyLookPackToDaySlots(
          seedDaySlotsWardrobe(toolSettings.slots, pack.wardrobeId || wardrobeId),
          pack
        );
        const notes = lookPackNotes(pack);
        updateToolSettings({
          slots: nextSlots,
          notes: notes || toolSettings.notes,
        });
        scheduleAfterCommit(() => setFilmStatus('Applied Moodboard look pack to day slots.'));
      }
    }
  }, [mounted, toolSettings.notes, toolSettings.slots, updateShared, updateToolSettings]);

  useEffect(() => {
    let cancelled = false;
    void fetchClothingSelectOptions('wardrobeCatalog', clothingGender).then(next => {
      if (cancelled) {
        return;
      }
      setWardrobeOptions(next);
      setWardrobeLoadedKey(wardrobeOptionsKey);
    });
    return () => {
      cancelled = true;
    };
  }, [clothingGender, wardrobeOptionsKey]);

  useEffect(() => {
    const ids = [
      ...new Set(slots.map(slot => slot.wardrobeId?.trim()).filter(Boolean) as string[]),
    ];
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    void fetchClothingLabels(ids).then(labels => {
      if (cancelled) {
        return;
      }
      setWardrobeLabels(previous => {
        const next = { ...previous };
        for (const [id, label] of labels) {
          if (label) {
            next[id] = label;
          }
        }
        return next;
      });
    });
    for (const id of ids) {
      const cached = getCachedClothingLabel(id);
      if (cached) {
        setWardrobeLabels(previous =>
          previous[id] === cached ? previous : { ...previous, [id]: cached }
        );
      }
    }
    return () => {
      cancelled = true;
    };
  }, [slots]);

  useEffect(() => {
    const sync = () => {
      const current = stillsRef.current;
      const wanted = new Set(
        current.map(still => still.promptId?.trim()).filter(Boolean) as string[]
      );
      const clipWanted = new Set(
        current.map(still => still.clipPromptId?.trim()).filter(Boolean) as string[]
      );
      if (wanted.size === 0 && clipWanted.size === 0) {
        return;
      }
      const gallery = loadComfyGallery()
        .filter(entry => wanted.has(entry.promptId) || clipWanted.has(entry.promptId))
        .map(entry => ({
          promptId: entry.promptId,
          status: entry.status,
          imageUrl: galleryEntryPrimaryViewUrl(entry),
          isClip: isGalleryClipEntry(entry) || clipWanted.has(entry.promptId),
        }));
      const merged = mergeDaySlotStills(current, gallery);
      if (merged.changed) {
        updateToolSettings({ stills: merged.stills });
      }
    };
    window.addEventListener(COMFYUI_GALLERY_UPDATED_EVENT, sync);
    sync();
    return () => window.removeEventListener(COMFYUI_GALLERY_UPDATED_EVENT, sync);
  }, [updateToolSettings]);

  const wardrobeLabelFor = useCallback(
    (wardrobeId?: string) => {
      const id = wardrobeId?.trim();
      if (!id) {
        return '';
      }
      return wardrobeLabels[id] ?? id;
    },
    [wardrobeLabels]
  );

  const buildSlotPrompt = useCallback(
    (slot: DaySlot) =>
      buildDaySlotPrompt({
        slot,
        wardrobeLabel: wardrobeLabelFor(slot.wardrobeId),
        characterName: character?.name,
        characterDescriptor: character?.descriptor || character?.hints,
        lockedLocation: shared.lockedLocation,
        notes: toolSettings.notes,
      }),
    [
      character?.descriptor,
      character?.hints,
      character?.name,
      shared.lockedLocation,
      toolSettings.notes,
      wardrobeLabelFor,
    ]
  );

  const queueSlot = useCallback(
    async (slot: DaySlot, options?: { manageBusy?: boolean }) => {
      const manageBusy = options?.manageBusy !== false;
      if (manageBusy) {
        setBusy(true);
      }
      setError(null);
      setCopied(false);
      setActiveSlotId(slot.id);
      actions.resetStatuses();
      try {
        const prompt = buildSlotPrompt(slot);
        // Play/Simple: skip lint round-trip — Day stills are draft-speed first film.
        const finalized = leanChrome
          ? prompt
          : await actions.finalizePrompt(prompt, character?.name || slot.label);
        setOutput(finalized);
        rememberDraftFields({
          toolKey: TOOL_ID,
          label: 'Day Planner',
          href: '/day',
          fields: [character?.name ?? '', slot.label, finalized],
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
        const promptId = await actions.sendComfyUi(finalized, undefined, undefined, {
          ...(queueOptions ?? {}),
          characterId: shared.activeCharacterId,
          lookId: shared.activeLookId ?? character?.activeLookId,
          // Play/Simple first-film path: draft stills; I2V animate stays Final.
          ...(leanChrome ? { qualityProfile: 'draft' as const } : {}),
        });
        const nextStills = upsertDaySlotStill(stillsRef.current, {
          slotId: slot.id,
          promptId: typeof promptId === 'string' ? promptId : undefined,
          status: promptId ? 'queued' : 'error',
          imageUrl: undefined,
        });
        stillsRef.current = nextStills;
        updateToolSettings({ stills: nextStills });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not queue that slot.');
        const nextStills = upsertDaySlotStill(stillsRef.current, {
          slotId: slot.id,
          status: 'error',
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
      buildSlotPrompt,
      character,
      hasPlate,
      leanChrome,
      plate,
      shared.activeCharacterId,
      shared.activeLookId,
      shared.identityKind,
      shared.ipAdapterStrength,
      updateToolSettings,
    ]
  );
  return {
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
    filmGuideHref,
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
  };
}

export type DayPlannerToolOrchestrationCore = ReturnType<typeof useDayPlannerToolOrchestrationCore>;
