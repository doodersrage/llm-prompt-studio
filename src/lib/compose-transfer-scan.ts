/**
 * Compose multi-image transfer scan — describe filled slots with vision, then
 * synthesize a short transfer instruction (pose from Image 1, people from 2+).
 * Server-only: do not import from 'use client' modules.
 */

import 'server-only';

import { normalizeComfyModel } from '@/lib/comfy-models';
import { normalizeDetailLevel, type DetailLevel } from '@/lib/detail-level';
import {
  resolveRequestLlmEnabled,
  resolveRequestLlmEndpoint,
  resolveRequestLlmModel,
  type LlmRequestOptions,
} from '@/lib/llm-request-options';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getLlmMaxInflight } from '@/lib/llm-backpressure';
import { generateImagePrompt } from '@/lib/specialized/image-prompt-generator';
import { chatCompletion } from '@/lib/llm-client';
import {
  COMPOSE_TRANSFER_RECIPE_GUIDANCE,
  composeTransferRoleForIndex,
  composeTransferVisionHintForRole,
  fallbackComposeTransferInstruction,
  normalizeComposeTransferRecipe,
  parseComposeTransferInstruction,
  type ComposeTransferRecipe,
  type ComposeTransferScanPart,
} from '@/lib/compose-transfer-scan-shared';

export type { ComposeTransferRecipe, ComposeTransferScanPart };
export {
  composeTransferRoleForIndex,
  fallbackComposeTransferInstruction,
  normalizeComposeTransferRecipe,
  parseComposeTransferInstruction,
};

export type ComposeTransferScanImage = {
  image: string;
  mimeType?: string;
  /** 1-based Image N label */
  index: number;
};

export async function runComposeTransferScan(options: {
  images: ComposeTransferScanImage[];
  recipe?: ComposeTransferRecipe;
  model?: string;
  detail?: DetailLevel | string;
  extraHints?: string;
  llm?: LlmRequestOptions;
}): Promise<{ prompt: string; parts: ComposeTransferScanPart[] }> {
  const images = options.images
    .filter(entry => entry.image?.trim() && entry.index >= 1 && entry.index <= 4)
    .slice(0, 4);
  if (images.length < 2) {
    throw new Error('Add at least Image 1 and one donor (Image 2–4) before a transfer scan.');
  }

  const recipe = normalizeComposeTransferRecipe(options.recipe);
  const model = normalizeComfyModel(options.model);
  const detail = normalizeDetailLevel(options.detail);
  const llm = options.llm;

  if (llm && resolveRequestLlmEnabled(llm) === false) {
    throw new Error(
      'Session LLM is disabled — enable it in Shared controls to run a transfer scan.'
    );
  }

  const parts: ComposeTransferScanPart[] = await mapWithConcurrency(
    images,
    getLlmMaxInflight(),
    async entry => {
      const { role, focus } = composeTransferRoleForIndex(entry.index, recipe);
      const result = await generateImagePrompt({
        model,
        detail,
        imageDataUrl: entry.image.trim(),
        mimeType: entry.mimeType,
        focus,
        descriptionPreset: 'standard',
        extraHints: [
          `This is Image ${entry.index} for a Compose transfer.`,
          composeTransferVisionHintForRole(role),
          options.extraHints?.trim() || '',
        ]
          .filter(Boolean)
          .join(' '),
        llm,
      });
      return {
        index: entry.index,
        role,
        prompt: result.prompt.trim(),
      };
    }
  );

  parts.sort((a, b) => a.index - b.index);

  const notes = parts
    .map(part => `Image ${part.index} [${part.role}]: ${part.prompt}`)
    .join('\n\n');

  const endpoint = llm ? resolveRequestLlmEndpoint(llm) : undefined;
  const synthesisModel = llm ? resolveRequestLlmModel(llm) : undefined;

  try {
    const raw = await chatCompletion({
      maxTokens: 280,
      temperature: 0.35,
      model: synthesisModel || undefined,
      endpoint,
      usageContext: { route: 'compose-transfer-scan' },
      messages: [
        {
          role: 'system',
          content: `You write Compose transfer instructions for multi-image edit models (Qwen Edit / Kontext / similar).
Return ONLY JSON: {"prompt":""}
- prompt: one short transfer instruction that explicitly names Image 1, Image 2, … as needed.
- Recipe: ${COMPOSE_TRANSFER_RECIPE_GUIDANCE[recipe]}
- Stay faithful to the vision notes. Do not invent people who are not described.
- No markdown, no commentary.`,
        },
        {
          role: 'user',
          content: [
            'Vision notes for each slot:',
            notes,
            options.extraHints?.trim() ? `\nUser hint: ${options.extraHints.trim()}` : '',
            '\nWrite the Compose transfer instruction now.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });
    const prompt = parseComposeTransferInstruction(raw);
    if (prompt) {
      return { prompt, parts };
    }
  } catch {
    // Fall through to deterministic merge.
  }

  return {
    prompt: fallbackComposeTransferInstruction(parts, recipe),
    parts,
  };
}
