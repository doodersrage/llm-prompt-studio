'use client';

import VisionScanButton from '@/components/VisionScanButton';
import { galleryPickPath } from '@/lib/gallery-handoff';
import { FieldLabel } from '@/components/ui/Field';
import { ChipButton } from '@/components/ui/Field';
import { Button, ButtonLink } from '@/components/ui/Button';
import type { useComposeToolOrchestration } from '@/hooks/useComposeToolOrchestration';
import { COMPOSE_TRANSFER_RECIPE_OPTIONS } from '@/lib/compose-transfer-scan-shared';

type ComposeSlot = ReturnType<typeof useComposeToolOrchestration>['slots'][number];

type Props = Pick<
  ReturnType<typeof useComposeToolOrchestration>,
  | 'mode'
  | 'toolSettings'
  | 'updateToolSettings'
  | 'isolating'
  | 'scanning'
  | 'isolateStatus'
  | 'transferScanRecipe'
  | 'setTransferScanRecipe'
  | 'scanTransferWithVision'
> & {
  slots: ComposeSlot[];
  assignFigure: ReturnType<typeof useComposeToolOrchestration>['assignFigure'];
  scanWithVision: () => void | Promise<void>;
};

export function ComposeToolImagesSection({
  mode,
  toolSettings,
  updateToolSettings,
  slots,
  isolating,
  scanning,
  isolateStatus,
  assignFigure,
  scanWithVision,
  scanTransferWithVision,
  transferScanRecipe,
  setTransferScanRecipe,
}: Props) {
  const filledDonorCount = slots.slice(1).filter(slot => slot.file || slot.previewUrl).length;
  const canTransferScan = Boolean(slots[0]?.file || slots[0]?.previewUrl) && filledDonorCount > 0;

  return (
    <>
      <FieldLabel hint="Image 1 is the base canvas. Isolate on white cuts Image 1 so the original background cannot leak. Images 2–4 stay intact as pose and scene donors. Transfer scan vision-reads every filled slot and writes a transfer instruction.">
        Images
      </FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <ChipButton
          active={toolSettings.isolateSubject === true}
          disabled={isolating}
          title="Cut Image 1 out and place them on a white backdrop before queueing. First use downloads a small on-device model. Continue-edit gallery handoffs skip this so the full canvas stays."
          onClick={() => {
            const next = !toolSettings.isolateSubject;
            updateToolSettings({ isolateSubject: next });
            const slot0 = slots[0];
            const original = slot0?.originalFile ?? slot0?.file;
            if (!original && !slot0?.originalPreviewUrl && !slot0?.previewUrl) {
              return;
            }
            if (!next) {
              void assignFigure(0, original, {
                skipIsolate: true,
                previewUrl: original ? undefined : slot0?.originalPreviewUrl || slot0?.previewUrl,
              });
              return;
            }
            void assignFigure(0, original, {
              isolate: true,
              previewUrl: original ? undefined : slot0?.originalPreviewUrl || slot0?.previewUrl,
            });
          }}
        >
          Isolate on white
        </ChipButton>
        {isolateStatus ? (
          <span className="text-xs text-[var(--text-muted)]">{isolateStatus}</span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((slot, index) => {
          const required = index === 0 || (mode === 'transfer' && index === 1);
          const disabled = (mode === 'modify' && index > 0) || (index === 0 && isolating);
          return (
            <div
              key={`figure-${index + 1}`}
              className={[
                'rounded-2xl border p-3 transition',
                disabled && !(index === 0 && isolating)
                  ? 'border-[var(--border-subtle)]/80 bg-[var(--bg-muted)]/20 opacity-45'
                  : 'border-[var(--border-subtle)] bg-gradient-to-b from-[var(--bg-muted)]/50 to-[var(--bg-base)]/40',
              ].join(' ')}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Image {index + 1}
                  {required ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--accent-text)]">
                      required
                    </span>
                  ) : null}
                  {index === 0 && slot.isolated ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">
                      on white
                    </span>
                  ) : null}
                </p>
                {slot.previewUrl ? (
                  <button
                    type="button"
                    disabled={mode === 'modify' && index > 0}
                    onClick={() => void assignFigure(index, null)}
                    className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:pointer-events-none"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={event => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = '';
                    void assignFigure(index, file);
                  }}
                  className="ui-file-input w-full disabled:opacity-50"
                />
                {index === 0 ? (
                  <>
                    <ButtonLink
                      href={galleryPickPath('compose')}
                      variant="secondary"
                      size="sm"
                      className="w-full justify-center"
                    >
                      Choose from Gallery
                    </ButtonLink>
                    <VisionScanButton
                      disabled={!slot.file && !slot.previewUrl}
                      scanning={scanning}
                      onClick={() => void scanWithVision()}
                    />
                  </>
                ) : null}
              </div>
              {slot.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slot.previewUrl}
                  alt={`Image ${index + 1} preview`}
                  className={[
                    'mt-3 max-h-40 w-full rounded-xl border border-[var(--border-subtle)] object-contain',
                    index === 0 && slot.isolated ? 'bg-white' : '',
                  ].join(' ')}
                />
              ) : (
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  {index === 0 ? 'Base / canvas image' : `Optional donor for transfer`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="mt-3 space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/30 p-3"
        data-testid="compose-transfer-scan"
      >
        <p className="text-sm font-medium text-[var(--text-primary)]">Transfer scan</p>
        <p className="type-caption text-[var(--text-muted)]">
          Vision-reads every filled slot, then writes a transfer instruction into the prompt box.
        </p>
        <div className="flex flex-wrap gap-2">
          {COMPOSE_TRANSFER_RECIPE_OPTIONS.map(option => (
            <ChipButton
              key={option.id}
              active={transferScanRecipe === option.id}
              disabled={scanning}
              title={option.title}
              onClick={() => setTransferScanRecipe(option.id)}
            >
              {option.label}
            </ChipButton>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canTransferScan || scanning}
          loading={scanning}
          loadingLabel="Scanning images"
          data-testid="compose-transfer-scan-button"
          onClick={() => void scanTransferWithVision()}
        >
          Scan all images → instruction
        </Button>
        {!canTransferScan ? (
          <p className="type-caption text-[var(--text-muted)]">
            Need Image 1 plus at least one of Images 2–4.
          </p>
        ) : null}
      </div>
    </>
  );
}
