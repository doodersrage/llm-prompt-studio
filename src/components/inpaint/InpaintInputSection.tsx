'use client';

import InpaintMaskEditor from '@/components/InpaintMaskEditor';
import EditToolRecipeStrip from '@/components/EditToolRecipeStrip';
import { HistoryHintSeedPanel } from '@/components/scene-tool/HistoryHintSeedPanel';
import ToolSetupBanner from '@/components/ToolSetupBanner';
import TurboEditStrengthControls from '@/components/TurboEditStrengthControls';
import VisionScanButton from '@/components/VisionScanButton';
import { TOOL_SETUP_LABELS } from '@/lib/tool-page-chrome';
import { normalizeHistorySeedScope, normalizeSceneHintSource } from '@/lib/scene-hint-source';
import { normalizeTurboEditStrength } from '@/lib/turbo-edit-strength';
import { galleryPickPath } from '@/lib/gallery-handoff';
import { ToolSection, accentButtonClass, accentFocusClass } from '@/components/ui/ToolPageShell';
import { FieldError, FieldLabel, TextArea } from '@/components/ui/Field';
import { ButtonLink, PrimaryButton } from '@/components/ui/Button';
import type { useInpaintToolOrchestration } from '@/hooks/useInpaintToolOrchestration';

const ACCENT = 'amber' as const;

type InpaintInputSectionProps = Pick<
  ReturnType<typeof useInpaintToolOrchestration>,
  | 'shared'
  | 'toolSettings'
  | 'updateShared'
  | 'updateToolSettings'
  | 'file'
  | 'previewUrl'
  | 'scanning'
  | 'anatomyRepairMode'
  | 'maskDescription'
  | 'changeDescription'
  | 'directPrompt'
  | 'setMaskDescription'
  | 'setChangeDescription'
  | 'setDirectPrompt'
  | 'output'
  | 'error'
  | 'actions'
  | 'queueImageOptions'
  | 'onMaskChange'
  | 'onFileChange'
  | 'scanWithVision'
  | 'assertReadyToQueue'
  | 'lintAndSetDirectPrompt'
>;

export default function InpaintInputSection({
  shared,
  toolSettings,
  updateShared,
  updateToolSettings,
  file,
  previewUrl,
  scanning,
  anatomyRepairMode,
  maskDescription,
  changeDescription,
  directPrompt,
  setMaskDescription,
  setChangeDescription,
  setDirectPrompt,
  output,
  error,
  actions,
  queueImageOptions,
  onMaskChange,
  onFileChange,
  scanWithVision,
  assertReadyToQueue,
  lintAndSetDirectPrompt,
}: InpaintInputSectionProps) {
  return (
    <>
      <ToolSetupBanner toolLabel={TOOL_SETUP_LABELS.inpaint} />
      <EditToolRecipeStrip
        toolId="inpaint"
        shared={shared}
        onApplied={next => updateShared(next)}
      />
      <TurboEditStrengthControls
        model={shared.model}
        tool="inpaint"
        value={normalizeTurboEditStrength(shared.turboEditStrength)}
        onChange={turboEditStrength => updateShared({ turboEditStrength })}
      />
      <HistoryHintSeedPanel
        tool="inpaint"
        hintSource={normalizeSceneHintSource(toolSettings.hintSource)}
        historySeedScope={normalizeHistorySeedScope(toolSettings.historySeedScope)}
        hints={changeDescription || maskDescription}
        randomTheme={toolSettings.randomTheme ?? ''}
        lastHistorySeedEntryId={toolSettings.lastHistorySeedEntryId}
        onHintSourceChange={source => updateToolSettings({ hintSource: source })}
        onHistorySeedScopeChange={scope => updateToolSettings({ historySeedScope: scope })}
        onHintsChange={value => setChangeDescription(value)}
        onRandomThemeChange={theme => updateToolSettings({ randomTheme: theme })}
        onHistorySeedApplied={result =>
          updateToolSettings({
            changeDescription: result.hints,
            lastHistorySeedEntryId: result.entryId,
            hintSource: 'history',
          })
        }
        accentFocusClassName={accentFocusClass(ACCENT)}
      />
      <ToolSection>
        {anatomyRepairMode ? (
          <p className="mb-4 rounded-xl border border-[var(--tint-danger-border)] bg-[var(--tint-danger-bg)] px-3.5 py-3 text-sm leading-relaxed text-[var(--tint-danger-text)]">
            <span className="font-medium text-[var(--tint-danger-text)]">Anatomy repair</span> —
            mask only the bad limb or hand. Prompts are pre-filled; tweak if needed, then queue with
            FLUX Inpaint.
          </p>
        ) : null}
        <FieldLabel htmlFor="inpaint-source-image">Source image</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="inpaint-source-image"
            type="file"
            accept="image/*"
            onChange={event => onFileChange(event.target.files?.[0] ?? null)}
            className="ui-file-input min-w-0 flex-1"
          />
          <ButtonLink href={galleryPickPath('inpaint')} variant="secondary" size="sm">
            Choose from Gallery
          </ButtonLink>
          <VisionScanButton
            disabled={!file && !previewUrl}
            scanning={scanning}
            onClick={() => void scanWithVision()}
          />
        </div>
        <p className="type-caption text-[var(--text-muted)]">
          Scan with vision fills What belongs in the mask from the still.
        </p>
        {previewUrl ? (
          <InpaintMaskEditor
            key={previewUrl}
            sourceImageUrl={previewUrl}
            onMaskChange={onMaskChange}
          />
        ) : (
          <p className="rounded-xl border border-[var(--tint-warning-border)] bg-[var(--tint-warning-bg)] px-3 py-2.5 text-xs text-[var(--tint-warning-text)]">
            Upload a source image to draw or upload the inpaint mask.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel hint="Optional — helps the LLM and instruction builder.">
              Mask region (words)
            </FieldLabel>
            <TextArea
              rows={2}
              value={maskDescription}
              onChange={event => setMaskDescription(event.target.value)}
              placeholder="e.g. sky above the horizon, subject's jacket"
              className={accentFocusClass(ACCENT)}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>What belongs in the mask</FieldLabel>
            <TextArea
              rows={2}
              value={changeDescription}
              onChange={event => setChangeDescription(event.target.value)}
              placeholder="e.g. dramatic storm clouds with warm edge light"
              className={accentFocusClass(ACCENT)}
            />
          </div>
        </div>

        <FieldLabel hint="Overrides the composed instruction when filled.">
          Prompt override (optional)
        </FieldLabel>
        <TextArea
          rows={3}
          value={directPrompt}
          onChange={event => setDirectPrompt(event.target.value)}
          placeholder="Leave empty to use the composed inpaint instruction…"
          className={`font-mono ${accentFocusClass(ACCENT)}`}
        />

        {output ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/80 p-3 text-xs text-[var(--text-secondary)]">
            {output}
          </pre>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <PrimaryButton
            accentClassName={accentButtonClass(ACCENT)}
            data-action="primary-generate"
            onClick={() => {
              if (!assertReadyToQueue()) {
                return;
              }
              void actions.sendComfyUi(output, undefined, undefined, queueImageOptions);
            }}
            disabled={!output.trim()}
          >
            Queue inpaint
          </PrimaryButton>
          <PrimaryButton
            accentClassName={accentButtonClass(ACCENT)}
            onClick={() => void lintAndSetDirectPrompt()}
            disabled={!output.trim()}
          >
            Lint &amp; fix prompt
          </PrimaryButton>
        </div>

        <FieldError>{error}</FieldError>
      </ToolSection>
    </>
  );
}
