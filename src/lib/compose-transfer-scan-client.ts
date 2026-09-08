import { sharedLlmRequestBody } from './llm-request-options';
import type { SharedToolSettings } from './settings-cache';
import { prepareVisionScanImagePayload } from './vision-scan-still';
import { resolveLocalImageFile } from './vision-still-scan-client';
import type { ComposeTransferRecipe } from './compose-transfer-scan-shared';

export type ComposeTransferScanSlot = {
  index: number;
  file: File | null;
  previewUrl: string | null | undefined;
};

export async function scanComposeTransferWithVision(options: {
  slots: ComposeTransferScanSlot[];
  recipe?: ComposeTransferRecipe;
  model?: string;
  detail?: string;
  extraHints?: string;
  shared?: Pick<
    SharedToolSettings,
    | 'sessionLlmTemperature'
    | 'sessionAllowTemplateFallback'
    | 'sessionLlmModel'
    | 'sessionLlmVisionModel'
    | 'sessionLlmEnabled'
    | 'sessionLlmProvider'
    | 'sessionLlmApiKey'
  >;
}): Promise<string> {
  const filled = options.slots.filter(slot => slot.file || slot.previewUrl);
  if (filled.length < 2) {
    throw new Error('Add Image 1 and at least one donor image before scanning a transfer.');
  }

  const images = await Promise.all(
    filled.slice(0, 4).map(async slot => {
      const file = await resolveLocalImageFile(
        slot.file,
        slot.previewUrl,
        `compose-image-${slot.index}.png`
      );
      const payload = await prepareVisionScanImagePayload(file);
      return {
        image: payload.image,
        mimeType: payload.mimeType,
        index: slot.index,
      };
    })
  );

  const response = await fetch('/api/compose/transfer-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      images,
      recipe: options.recipe,
      model: options.model,
      detail: options.detail,
      extraHints: options.extraHints,
      ...(options.shared ? sharedLlmRequestBody(options.shared) : {}),
    }),
  });
  const data = (await response.json()) as { prompt?: string; error?: string };
  if (!response.ok || !data.prompt?.trim()) {
    throw new Error(data.error ?? 'Transfer scan failed.');
  }
  return data.prompt.trim();
}
