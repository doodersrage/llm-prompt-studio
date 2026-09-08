import { apiError, apiJson, apiMethodNotAllowed } from '@/lib/api/response';
import { parseLlmRequestOptions } from '@/lib/llm-request-options';
import {
  normalizeComposeTransferRecipe,
  runComposeTransferScan,
  type ComposeTransferScanImage,
} from '@/lib/compose-transfer-scan';
import { LlmBusyError } from '@/lib/llm-client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      images?: ComposeTransferScanImage[];
      recipe?: string;
      model?: string;
      detail?: string;
      extraHints?: string;
      llmTemperature?: number;
      allowTemplateFallback?: boolean;
      llmModel?: string;
      llmVisionModel?: string;
      llmEnabled?: boolean;
      llmProvider?: string;
      llmApiKey?: string;
    };

    const images = (body.images ?? [])
      .filter(entry => entry?.image?.trim())
      .map((entry, order) => ({
        image: entry.image.trim(),
        mimeType: entry.mimeType,
        index:
          typeof entry.index === 'number' && entry.index >= 1 && entry.index <= 4
            ? Math.floor(entry.index)
            : order + 1,
      }));

    if (images.length < 2) {
      return apiError('At least two images are required for a transfer scan.', 400);
    }
    if (images.length > 4) {
      return apiError('At most 4 reference images are supported.', 400);
    }

    const result = await runComposeTransferScan({
      images,
      recipe: normalizeComposeTransferRecipe(body.recipe),
      model: body.model,
      detail: body.detail,
      extraHints: body.extraHints,
      llm: parseLlmRequestOptions(body),
    });

    return apiJson({
      prompt: result.prompt,
      parts: result.parts,
      recipe: normalizeComposeTransferRecipe(body.recipe),
    });
  } catch (error) {
    if (error instanceof LlmBusyError) {
      return apiError(error.message, 503);
    }
    return apiError(error instanceof Error ? error.message : 'Compose transfer scan failed.', 400);
  }
}

export function OPTIONS() {
  return apiMethodNotAllowed(['POST'], '/api/compose/transfer-scan');
}
