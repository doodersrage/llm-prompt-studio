'use client';

import {
  CollapsibleSection,
  ToolSection,
  accentButtonClass,
  accentFocusClass,
} from '@/components/ui/ToolPageShell';
import { FieldError, FieldLabel, TextArea } from '@/components/ui/Field';
import { PrimaryButton } from '@/components/ui/Button';
import { ComposeToolModeSection } from '@/components/compose/sections/ComposeToolModeSection';
import { ComposeToolImagesSection } from '@/components/compose/sections/ComposeToolImagesSection';
import { ComposeToolIdentityMaskSection } from '@/components/compose/sections/ComposeToolIdentityMaskSection';
import type { useComposeToolOrchestration } from '@/hooks/useComposeToolOrchestration';

const ACCENT = 'cyan' as const;

type Props = Pick<
  ReturnType<typeof useComposeToolOrchestration>,
  | 'mode'
  | 'output'
  | 'setOutput'
  | 'error'
  | 'instruction'
  | 'setInstruction'
  | 'actions'
  | 'assertReadyToQueue'
  | 'applyTemplate'
  | 'templateGroups'
  | 'filledCount'
  | 'templateMinFigures'
>;

export function ComposeToolInstructionSection({
  mode,
  output,
  setOutput,
  error,
  instruction,
  setInstruction,
  actions,
  assertReadyToQueue,
  applyTemplate,
  templateGroups,
  filledCount,
  templateMinFigures,
}: Props) {
  return (
    <>
      <CollapsibleSection
        title="Starter templates"
        summary={`${templateGroups.reduce((n, g) => n + g.templates.length, 0)} presets — click to expand`}
        defaultOpen={false}
        persistKey={`compose-templates-${mode}`}
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-4"
      >
        <div className="space-y-4">
          {templateGroups.map(group => (
            <div key={group.id} className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.templates.map(template => {
                  const minFigures = templateMinFigures(template);
                  const disabled = filledCount < minFigures;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      disabled={disabled}
                      title={
                        disabled
                          ? `Needs at least ${minFigures} image${minFigures === 1 ? '' : 's'} uploaded`
                          : template.instruction
                      }
                      onClick={() => applyTemplate(template.instruction)}
                      className={[
                        'rounded-xl border px-3 py-1.5 text-xs transition',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                        disabled
                          ? 'cursor-not-allowed border-[var(--border-subtle)]/60 bg-[var(--bg-muted)]/30 text-[var(--text-muted)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/45 text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-muted)] hover:text-[var(--accent-text)]',
                      ].join(' ')}
                    >
                      {template.label}
                      {minFigures > 1 ? (
                        <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                          · {minFigures}img
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <FieldLabel>{mode === 'transfer' ? 'Transfer instruction' : 'Modify instruction'}</FieldLabel>
      <TextArea
        rows={5}
        value={instruction}
        onChange={event => setInstruction(event.target.value)}
        placeholder={
          mode === 'transfer'
            ? 'Take the jacket from Image 2 and apply it to the person in Image 1…'
            : 'keep: subject face and pose\nreplace: background with misty forest…'
        }
        className={`font-mono ${accentFocusClass(ACCENT)}`}
      />

      <PrimaryButton
        accentClassName={accentButtonClass(ACCENT)}
        data-action="primary-generate"
        onClick={() => {
          if (!assertReadyToQueue()) {
            return;
          }
          void actions.finalizePrompt(output, instruction).then((finalized: string) => {
            setOutput(finalized);
          });
        }}
        disabled={!instruction.trim()}
      >
        Prepare instruction
      </PrimaryButton>

      <FieldError>{error}</FieldError>
    </>
  );
}

export function ComposeToolFormSection(props: ReturnType<typeof useComposeToolOrchestration>) {
  const {
    shared,
    toolSettings,
    updateShared,
    updateToolSettings,
    slots,
    mode,
    setMode,
    showPoseUnlockHint,
    booguEditModel,
    identityLock,
    ...rest
  } = props;

  return (
    <ToolSection>
      <ComposeToolModeSection
        mode={mode}
        setMode={setMode}
        showPoseUnlockHint={showPoseUnlockHint}
        booguEditModel={booguEditModel}
        identityLock={identityLock}
      />
      <ComposeToolImagesSection
        mode={mode}
        toolSettings={toolSettings}
        updateToolSettings={updateToolSettings}
        slots={slots}
        isolating={rest.isolating}
        scanning={rest.scanning}
        isolateStatus={rest.isolateStatus}
        assignFigure={rest.assignFigure}
        scanWithVision={rest.scanWithVision}
        scanTransferWithVision={rest.scanTransferWithVision}
        transferScanRecipe={rest.transferScanRecipe}
        setTransferScanRecipe={rest.setTransferScanRecipe}
      />
      <ComposeToolIdentityMaskSection
        shared={shared}
        toolSettings={toolSettings}
        updateShared={updateShared}
        updateToolSettings={updateToolSettings}
        maskPreviewUrl={rest.maskPreviewUrl}
        showMaskEditor={rest.showMaskEditor}
        setShowMaskEditor={rest.setShowMaskEditor}
        cloudComposeSingleRef={rest.cloudComposeSingleRef}
        cloudComposeModelId={rest.cloudComposeModelId}
        onMaskChange={rest.onMaskChange}
        identityLock={identityLock}
        identityLockStrength={rest.identityLockStrength}
        identityKind={rest.identityKind}
        identityLockHint={rest.identityLockHint}
        regionalSlots={rest.regionalSlots}
        fig1Preview={rest.fig1Preview}
        booguEditModel={booguEditModel}
        zImageModel={rest.zImageModel}
      />
      <ComposeToolInstructionSection mode={mode} {...rest} />
    </ToolSection>
  );
}
