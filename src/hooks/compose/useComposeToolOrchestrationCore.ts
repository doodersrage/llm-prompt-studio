'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCachedSettings } from '@/hooks/useCachedSettings';
import { useSeedToolDraft } from '@/hooks/useSeedToolDraft';
import { useGalleryHandoff } from '@/hooks/useGalleryHandoff';
import { usePromptResultActions } from '@/hooks/usePromptResultActions';
import type { ComfyImageModel } from '@/lib/comfy-models/client';
import type { WorkflowParamValues } from '@/lib/comfyui-config';
import { getComfyModelDefinition } from '@/lib/comfy-models/client';
import {
  isComposeCapableModel,
  isBooguEditModel,
  isFluxKleinModel,
  isQwenEditModel,
  isZImageModel,
} from '@/lib/model-denoise-defaults';
import { normalizeTurboEditStrength } from '@/lib/turbo-edit-strength';
import { getReformatTargetModel } from '@/lib/reformat-target';
import {
  buildComposeInstruction,
  COMPOSE_DEFAULT_MODEL,
  COMPOSE_MODIFY_TEMPLATE_GROUPS,
  COMPOSE_TRANSFER_TEMPLATE_GROUPS,
  isAggressiveComposeInstruction,
  type ComposeMode,
  type ComposeStarterTemplate,
} from '@/lib/compose-prompt';
import {
  DEFAULT_COMPOSE_IDENTITY_LOCK_STRENGTH,
  formatComposeIdentityLockHint,
  formatKleinEnhancerComposeHint,
  formatKleinEnhancerIdentityHint,
  normalizeComposeIdentityKind,
  normalizeComposeIdentityLockStrength,
} from '@/lib/compose-identity-lock';
import { createDefaultRegionalSlots } from '@/lib/regional-prompt-slots';
import { regionalSlotsQueueExtras } from '@/components/RegionalEditPanel';
import { sharedPatchFromGalleryHandoff } from '@/lib/gallery-handoff';
import {
  isolateSubjectOnWhite,
  ISOLATE_QUEUE_BLOCKED_MESSAGE,
  normalizeIsolateSubject,
} from '@/lib/isolate-subject';
import {
  CLOUD_COMPOSE_TRANSFER_BLOCKED,
  cloudComposeBlocksTransfer,
  cloudComposeSendsOnlyImage1,
} from '@/lib/cloud-compose-refs';
import { isCloudEngine } from '@/lib/engine/capabilities';
import { loadEngineSettings } from '@/lib/engine-settings';
import { DEFAULT_IMAGE_COMPOSE_TOOL_CACHE } from '@/lib/settings-cache';
import { rememberDraftFields } from '@/lib/remember-draft-fields';
import { scheduleAfterCommit } from '@/lib/schedule-after-commit';
import {
  emptyFigure,
  emptySlots,
  fileFromPreviewUrl,
  revokeBlobUrl,
  revokeFigureUrls,
  type FigureSlot,
} from '@/lib/compose-figure-slot';
import { resolveLocalImageFile, scanStillWithVision } from '@/lib/vision-still-scan-client';
import { scanComposeTransferWithVision } from '@/lib/compose-transfer-scan-client';
import {
  normalizeComposeTransferRecipe,
  type ComposeTransferRecipe,
} from '@/lib/compose-transfer-scan-shared';

export function useComposeToolOrchestrationCore() {
  const { mounted, shared, toolSettings, updateShared, updateToolSettings } = useCachedSettings(
    'imageCompose',
    DEFAULT_IMAGE_COMPOSE_TOOL_CACHE
  );

  const [slots, setSlots] = useState<FigureSlot[]>(emptySlots);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | null>(null);
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [handoffQueueParams, setHandoffQueueParams] = useState<WorkflowParamValues | undefined>();
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isolating, setIsolating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [isolateStatus, setIsolateStatus] = useState<string | null>(null);
  const isolateGenRef = useRef(0);
  const autoIsolateAttemptedRef = useRef(false);

  const instruction = toolSettings.instruction ?? '';
  const mode = (toolSettings.mode ?? 'transfer') as ComposeMode;
  const isolateSubject = normalizeIsolateSubject(toolSettings.isolateSubject);

  const setInstruction = useCallback(
    (value: string) => {
      updateToolSettings({ instruction: value });
      rememberDraftFields({
        toolKey: 'compose',
        label: 'Compose',
        href: '/compose',
        fields: [value],
      });
    },
    [updateToolSettings]
  );

  const scanWithVision = useCallback(async () => {
    const slot = slots[0];
    if (!slot?.file && !slot?.previewUrl) {
      setError('Add Image 1 first.');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const image = await resolveLocalImageFile(slot.file, slot.previewUrl, 'compose-image-1.png');
      const prompt = await scanStillWithVision({
        image,
        purpose: 'compose',
        model: shared.model,
        detail: shared.detail,
        extraHints: instruction.trim() || undefined,
        shared,
      });
      setInstruction(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vision scan failed.');
    } finally {
      setScanning(false);
    }
  }, [instruction, setInstruction, shared, slots]);

  const setMode = useCallback(
    (next: ComposeMode) => {
      updateToolSettings({ mode: next });
    },
    [updateToolSettings]
  );

  const transferScanRecipe = normalizeComposeTransferRecipe(toolSettings.transferScanRecipe);

  const setTransferScanRecipe = useCallback(
    (recipe: ComposeTransferRecipe) => {
      updateToolSettings({ transferScanRecipe: recipe });
    },
    [updateToolSettings]
  );

  const scanTransferWithVision = useCallback(async () => {
    const filled = slots
      .map((slot, index) => ({ slot, index: index + 1 }))
      .filter(({ slot }) => slot.file || slot.previewUrl);
    if (filled.length < 2) {
      setError('Add Image 1 and at least one donor (Image 2–4) for a transfer scan.');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      if (mode !== 'transfer') {
        setMode('transfer');
      }
      const prompt = await scanComposeTransferWithVision({
        slots: filled.map(({ slot, index }) => ({
          index,
          file: slot.file,
          previewUrl: slot.previewUrl,
        })),
        recipe: transferScanRecipe,
        model: shared.model,
        detail: shared.detail,
        extraHints: instruction.trim() || undefined,
        shared,
      });
      setInstruction(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer scan failed.');
    } finally {
      setScanning(false);
    }
  }, [instruction, mode, setInstruction, setMode, shared, slots, transferScanRecipe]);

  useSeedToolDraft(mounted, {
    toolKey: 'compose',
    label: 'Compose',
    href: '/compose',
    fields: [instruction],
  });

  const actions = usePromptResultActions({
    tool: 'compose',
    model: shared.model,
    detail: shared.detail,
    hints: instruction,
    autoFixRules: shared.autoFixRules !== false,
    reformatTarget: getReformatTargetModel(shared.model),
  });

  const selectedModel = getComfyModelDefinition(shared.model);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (!isComposeCapableModel(shared.model)) {
      updateShared({ model: COMPOSE_DEFAULT_MODEL });
    }
  }, [mounted, shared.model, updateShared]);

  const filledCount = useMemo(
    () => slots.filter(slot => slot.file || slot.previewUrl).length,
    [slots]
  );
  const extraFilledCount = useMemo(
    () => slots.slice(1).filter(slot => slot.file || slot.previewUrl).length,
    [slots]
  );
  const cloudComposeModelId = useMemo(() => {
    const engine = shared.inferenceEngine;
    if (engine === 'fal') {
      return shared.falImg2ImgModel || loadEngineSettings().falImg2ImgModel;
    }
    if (engine === 'replicate') {
      return shared.replicateImg2ImgModel || loadEngineSettings().replicateImg2ImgModel;
    }
    return undefined;
  }, [shared.falImg2ImgModel, shared.inferenceEngine, shared.replicateImg2ImgModel]);
  const cloudComposeSingleRef =
    isCloudEngine(shared.inferenceEngine) &&
    extraFilledCount > 0 &&
    cloudComposeSendsOnlyImage1(shared.inferenceEngine, cloudComposeModelId);

  useEffect(() => {
    if (filledCount > 0) {
      updateToolSettings({ figureCountHint: Math.max(1, filledCount) });
    }
  }, [filledCount, updateToolSettings]);

  const builtOutput = useMemo(
    () =>
      buildComposeInstruction({
        mode,
        instruction,
        figureCount: Math.max(filledCount, mode === 'transfer' ? 2 : 1),
        model: shared.model,
        isolatedSubject: slots[0]?.isolated === true,
        turboEditStrength: normalizeTurboEditStrength(shared.turboEditStrength),
      }),
    [filledCount, instruction, mode, shared.model, shared.turboEditStrength, slots]
  );

  useEffect(() => {
    scheduleAfterCommit(() => {
      setOutput(builtOutput);
    });
  }, [builtOutput]);

  const clearMaskState = useCallback(() => {
    setMaskFile(null);
    setMaskPreviewUrl(current => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, []);

  const onMaskChange = useCallback((nextFile: File | null, nextPreviewUrl: string | null) => {
    setMaskFile(nextFile);
    setMaskPreviewUrl(current => {
      if (current && current !== nextPreviewUrl) {
        URL.revokeObjectURL(current);
      }
      return nextPreviewUrl;
    });
  }, []);

  const assignFigure = useCallback(
    async (
      index: number,
      nextFile: File | null,
      options?: { skipIsolate?: boolean; isolate?: boolean; previewUrl?: string | null }
    ) => {
      if (index !== 0) {
        setSlots(current => {
          const next = current.map(slot => ({ ...slot }));
          revokeFigureUrls(next[index]);
          next[index] = nextFile
            ? {
                file: nextFile,
                originalFile: nextFile,
                previewUrl: URL.createObjectURL(nextFile),
                originalPreviewUrl: null,
                isolated: false,
              }
            : emptyFigure();
          return next;
        });
        return;
      }

      isolateGenRef.current += 1;
      const gen = isolateGenRef.current;
      clearMaskState();

      const incomingPreview = options?.previewUrl ?? null;
      if (!nextFile && !incomingPreview) {
        setSlots(current => {
          const next = current.map(slot => ({ ...slot }));
          revokeFigureUrls(next[0]);
          next[0] = emptyFigure();
          return next;
        });
        setIsolateStatus(null);
        setIsolating(false);
        return;
      }

      const originalPreviewUrl =
        incomingPreview ?? (nextFile ? URL.createObjectURL(nextFile) : null);
      setSlots(current => {
        const next = current.map(slot => ({ ...slot }));
        const prev = next[0];
        if (prev) {
          if (prev.previewUrl && prev.previewUrl !== originalPreviewUrl) {
            revokeBlobUrl(prev.previewUrl);
          }
          if (
            prev.originalPreviewUrl &&
            prev.originalPreviewUrl !== originalPreviewUrl &&
            prev.originalPreviewUrl !== prev.previewUrl
          ) {
            revokeBlobUrl(prev.originalPreviewUrl);
          }
        }
        next[0] = {
          file: nextFile,
          originalFile: nextFile,
          previewUrl: originalPreviewUrl,
          originalPreviewUrl,
          isolated: false,
        };
        return next;
      });

      const shouldIsolate = (options?.isolate ?? isolateSubject) && !options?.skipIsolate;
      if (!shouldIsolate) {
        setIsolateStatus(null);
        setIsolating(false);
        return;
      }

      setIsolating(true);
      setIsolateStatus('Isolating subject on white…');
      setError(null);
      try {
        const source =
          nextFile ??
          (await fileFromPreviewUrl(
            incomingPreview as string,
            `compose-image-1-${Date.now()}.png`
          ));
        if (gen !== isolateGenRef.current) {
          return;
        }
        const cutout = await isolateSubjectOnWhite(source, source.name);
        if (gen !== isolateGenRef.current) {
          return;
        }
        const cutoutPreview = URL.createObjectURL(cutout);
        setSlots(current => {
          const next = current.map(slot => ({ ...slot }));
          const prev = next[0];
          if (prev?.previewUrl && prev.previewUrl !== prev.originalPreviewUrl) {
            revokeBlobUrl(prev.previewUrl);
          }
          next[0] = {
            file: cutout,
            originalFile: prev?.originalFile ?? source,
            previewUrl: cutoutPreview,
            originalPreviewUrl: prev?.originalPreviewUrl ?? originalPreviewUrl,
            isolated: true,
          };
          return next;
        });
        setIsolateStatus('Subject isolated on white.');
      } catch (err) {
        if (gen !== isolateGenRef.current) {
          return;
        }
        setIsolateStatus(null);
        setError(
          err instanceof Error
            ? `${err.message} ${ISOLATE_QUEUE_BLOCKED_MESSAGE}`
            : ISOLATE_QUEUE_BLOCKED_MESSAGE
        );
      } finally {
        if (gen === isolateGenRef.current) {
          setIsolating(false);
        }
      }
    },
    [clearMaskState, isolateSubject]
  );

  useEffect(() => {
    if (!isolateSubject) {
      autoIsolateAttemptedRef.current = false;
      return;
    }
    if (isolating) {
      return;
    }
    const slot0 = slots[0];
    if (slot0?.isolated) {
      autoIsolateAttemptedRef.current = false;
      return;
    }
    const original = slot0?.originalFile ?? slot0?.file ?? null;
    const preview = slot0?.originalPreviewUrl || slot0?.previewUrl || null;
    if (!original && !preview) {
      autoIsolateAttemptedRef.current = false;
      return;
    }
    if (autoIsolateAttemptedRef.current) {
      return;
    }
    autoIsolateAttemptedRef.current = true;
    void assignFigure(0, original, {
      isolate: true,
      previewUrl: original ? undefined : preview,
    });
  }, [assignFigure, isolateSubject, isolating, slots]);

  const applyGalleryHandoff = useCallback(
    (handoff: {
      prompt: string;
      model?: string;
      queueParams?: WorkflowParamValues;
      sessionActiveLoraIds?: string[];
      queueQualityProfile?: import('@/lib/queue-quality-profile').QueueQualityProfile;
      handoffMode?: import('@/lib/gallery-handoff').GalleryHandoffMode;
      file: File | null;
      previewUrl: string | null;
      payload?: import('@/lib/gallery-handoff').GalleryHandoffPayload;
    }) => {
      if (handoff.handoffMode === 'reedit' && handoff.prompt.trim()) {
        setInstruction(handoff.prompt.trim());
      }
      if (handoff.handoffMode === 'reedit' && handoff.queueParams) {
        const rest = { ...handoff.queueParams };
        delete rest.width;
        delete rest.height;
        setHandoffQueueParams(rest);
      } else {
        setHandoffQueueParams(undefined);
      }
      const sharedPatch = handoff.payload
        ? sharedPatchFromGalleryHandoff(handoff.payload)
        : {
            sessionActiveLoraIds: handoff.sessionActiveLoraIds,
            queueQualityProfile: handoff.queueQualityProfile,
          };
      if (handoff.model && isComposeCapableModel(handoff.model)) {
        updateShared({
          model: handoff.model as ComfyImageModel,
          ...sharedPatch,
        });
      } else {
        updateShared({
          model: COMPOSE_DEFAULT_MODEL,
          ...sharedPatch,
        });
      }
      const restoredKind = handoff.payload?.identityKind ?? handoff.queueParams?.identityKind;
      if (restoredKind) {
        updateToolSettings({
          identityKind: normalizeComposeIdentityKind(restoredKind),
          identityLock: true,
        });
      }
      void assignFigure(0, handoff.file, {
        skipIsolate: handoff.handoffMode === 'reedit',
        previewUrl: handoff.previewUrl,
      });
    },
    [assignFigure, setInstruction, updateShared, updateToolSettings]
  );

  useGalleryHandoff('compose', applyGalleryHandoff);
  return {
    autoIsolateAttemptedRef,
    cloudComposeModelId,
    extraFilledCount,
    setCopied,
    setError,
    handoffQueueParams,
    maskFile,
    mounted,
    shared,
    toolSettings,
    updateShared,
    updateToolSettings,
    slots,
    maskPreviewUrl,
    showMaskEditor,
    setShowMaskEditor,
    output,
    setOutput,
    error,
    copied,
    isolating,
    scanning,
    isolateStatus,
    instruction,
    setInstruction,
    mode,
    setMode,
    isolateSubject,
    scanWithVision,
    scanTransferWithVision,
    transferScanRecipe,
    setTransferScanRecipe,
    actions,
    selectedModel,
    filledCount,
    cloudComposeSingleRef,
    onMaskChange,
    assignFigure,
  };
}

export type ComposeToolOrchestrationCore = ReturnType<typeof useComposeToolOrchestrationCore>;
