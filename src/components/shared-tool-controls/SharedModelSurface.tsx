'use client';

import dynamic from 'next/dynamic';
import type { DiffusersCheckpointOption } from '@/components/DiffusersCheckpointSelector';
import CharacterOsPicker from '@/components/CharacterOsPicker';
import { Button } from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/Field';
import {
  COMFY_IMAGE_MODELS,
  getComfyModelDefinition,
  type ComfyImageModel,
} from '@/lib/comfy-models/client';
import { engineDisplayName } from '@/lib/engine/capabilities';
import { resolveCloudTxt2ImgModel } from '@/lib/engine-settings';
import { isBooguEditModel } from '@/lib/model-denoise-defaults';
import type { SupportedModelsSource } from '@/lib/model-workflow-map';
import { resolveTxt2iCounterpartForGenerate } from '@/lib/queue-tool-model';
import type { SharedToolSettings } from '@/lib/settings-cache';
import { loadSettingsCache, saveSharedSettings } from '@/lib/settings-cache';

const ModelSelector = dynamic(() => import('@/components/ModelSelector'), {
  ssr: false,
  loading: () => <div className="h-10 animate-pulse rounded-xl bg-[var(--surface-muted)]/60" />,
});
const DiffusersCheckpointSelector = dynamic(
  () => import('@/components/DiffusersCheckpointSelector'),
  {
    ssr: false,
    loading: () => <div className="h-10 animate-pulse rounded-xl bg-[var(--surface-muted)]/60" />,
  }
);
const DiffusersQueueHint = dynamic(() => import('@/components/DiffusersQueueHint'), {
  ssr: false,
  loading: () => null,
});

export type SharedModelSurfaceProps = {
  shared: SharedToolSettings;
  cloudEngine: boolean;
  systemPathActive: boolean;
  roleplayVariant: boolean;
  toolId?: string;
  diffusersSelectedAssetId: string;
  onDiffusersAssetChange: (asset: DiffusersCheckpointOption) => void;
  pickerModels: ComfyImageModel[];
  modelFilterHint: string | null | undefined;
  categoryLocked: boolean;
  showAllModelsOverride: boolean;
  supportedModelsSource: SupportedModelsSource;
  onShowAllModels: () => void;
  onModelChange: (model: ComfyImageModel) => void;
  /** Character OS applies model via the parent prop (not the full model-change handler). */
  onCharacterModelChange?: (model: ComfyImageModel) => void;
  recommendFromText?: string;
  onSharedSettingsChange?: (partial: Partial<SharedToolSettings>) => void;
  selectedWorkflowJson: string | null;
};

export default function SharedModelSurface({
  shared,
  cloudEngine,
  systemPathActive,
  roleplayVariant,
  toolId,
  diffusersSelectedAssetId,
  onDiffusersAssetChange,
  pickerModels,
  modelFilterHint,
  categoryLocked,
  showAllModelsOverride,
  supportedModelsSource,
  onShowAllModels,
  onModelChange,
  onCharacterModelChange,
  recommendFromText,
  onSharedSettingsChange,
  selectedWorkflowJson,
}: SharedModelSurfaceProps) {
  return (
    <div className="space-y-3">
      <FieldLabel
        hint={
          cloudEngine
            ? `${engineDisplayName(shared.inferenceEngine)} ignores Comfy workflows, LoRAs, and live latents. Image 1 is sent as img2img when present.`
            : shared.inferenceEngine === 'diffusers'
              ? 'Optional Diffusers stills inventory. Prefer ComfyUI for Lightning quality/speed on 24GB and for Play film.'
              : systemPathActive
                ? undefined
                : shared.autoSelectWorkflowForModel !== false
                  ? 'Choosing a model auto-selects its mapped ComfyUI workflow below (when configured).'
                  : 'Shared across tools and remembered between page reloads.'
        }
      >
        {cloudEngine
          ? `${engineDisplayName(shared.inferenceEngine)} model`
          : shared.inferenceEngine === 'diffusers'
            ? 'Diffusers model (Qwen / Flux)'
            : systemPathActive
              ? 'Model'
              : 'Target model'}
      </FieldLabel>
      {cloudEngine ? (
        <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/40 px-3 py-2.5">
          <p className="text-sm text-[var(--text-primary)]">
            {resolveCloudTxt2ImgModel(shared.inferenceEngine)}
          </p>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            Cloud txt2img via {engineDisplayName(shared.inferenceEngine)}. Change the key and model
            in{' '}
            <a
              href="/settings?tab=comfyui&section=inference-engine"
              className="text-[var(--text-secondary)] underline-offset-2 hover:underline"
            >
              Settings → Inference engine
            </a>
            .
          </p>
        </div>
      ) : shared.inferenceEngine === 'diffusers' && !roleplayVariant ? (
        <DiffusersCheckpointSelector
          value={diffusersSelectedAssetId}
          onChange={onDiffusersAssetChange}
        />
      ) : (
        <ModelSelector
          value={shared.model}
          allowedModels={pickerModels.length < COMFY_IMAGE_MODELS.length ? pickerModels : undefined}
          filterHint={modelFilterHint}
          onShowAllModels={
            categoryLocked || showAllModelsOverride || supportedModelsSource === 'disabled'
              ? undefined
              : onShowAllModels
          }
          onChange={onModelChange}
        />
      )}
      {!roleplayVariant && toolId !== 'audio' && toolId !== 'mesh' ? (
        <CharacterOsPicker
          shared={shared}
          hints={recommendFromText}
          onApply={patch => {
            if (onSharedSettingsChange) {
              onSharedSettingsChange(patch);
            } else {
              saveSharedSettings({
                ...loadSettingsCache().shared,
                ...patch,
              });
            }
            if (patch.model && onCharacterModelChange) {
              onCharacterModelChange(patch.model as ComfyImageModel);
            }
          }}
        />
      ) : null}
      {shared.inferenceEngine === 'diffusers' && !roleplayVariant ? (
        <DiffusersQueueHint workflowJson={selectedWorkflowJson} />
      ) : null}
      {!roleplayVariant &&
      !cloudEngine &&
      toolId === 'generate' &&
      /qwen-image-edit-2511-lightning/i.test(shared.model) ? (
        <div className="space-y-2 rounded-xl border border-[var(--tint-warning-border)] bg-[var(--tint-warning-bg)] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-[var(--tint-warning-text)]">
            Edit-2511 Lightning on Generate runs as T2I (reference images disconnected). For clean
            scene generation prefer{' '}
            <span className="font-medium text-[var(--tint-warning-text)]">
              Qwen-Image-2512 Lightning
            </span>
            ; keep Edit Lightning for Refine / img2img.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => onModelChange(resolveTxt2iCounterpartForGenerate(shared.model))}
          >
            Switch to{' '}
            {getComfyModelDefinition(resolveTxt2iCounterpartForGenerate(shared.model)).label}
          </Button>
        </div>
      ) : null}
      {!roleplayVariant && toolId === 'generate' && isBooguEditModel(shared.model) ? (
        <div className="space-y-2 rounded-xl border border-[var(--tint-warning-border)] bg-[var(--tint-warning-bg)] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-[var(--tint-warning-text)]">
            Boogu Edit is instruction TI2I only — upload a reference on{' '}
            <span className="font-medium text-[var(--tint-warning-text)]">Refine</span>,{' '}
            <span className="font-medium text-[var(--tint-warning-text)]">Compose</span>, or{' '}
            <span className="font-medium text-[var(--tint-warning-text)]">Image → Prompt</span>{' '}
            instead of Generate.
          </p>
        </div>
      ) : null}
    </div>
  );
}
