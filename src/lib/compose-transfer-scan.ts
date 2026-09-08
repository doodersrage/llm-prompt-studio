/**
 * Compose multi-image transfer scan — describe filled slots with vision, then
 * synthesize a short transfer instruction (pose from Image 1, people from 2+).
 */

import { normalizeComfyModel } from '@/lib/comfy-models';
import { normalizeDetailLevel, type DetailLevel } from '@/lib/detail-level';
import {
  resolveRequestLlmEnabled,
  resolveRequestLlmEndpoint,
  resolveRequestLlmModel,
  type LlmRequestOptions,
} from '@/lib/llm-request-options';
import { stripPromptArtifacts } from '@/lib/prompt-cleanup';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getLlmMaxInflight } from '@/lib/llm-backpressure';
import { generateImagePrompt } from '@/lib/specialized/image-prompt-generator';
import { chatCompletion } from '@/lib/llm-client';

export type ComposeTransferScanImage = {
  image: string;
  mimeType?: string;
  /** 1-based Image N label */
  index: number;
};

export type ComposeTransferRecipe = 'pose-from-1-people-from-rest' | 'people-from-1-pose-from-2';

export type ComposeTransferScanPart = {
  index: number;
  role: string;
  prompt: string;
};

const RECIPE_GUIDANCE: Record<ComposeTransferRecipe, string> = {
  'pose-from-1-people-from-rest':
    'Pose, action, and framing come from Image 1. Persons / identity / look come from Image 2+ (and later images for wardrobe or scene when present).',
  'people-from-1-pose-from-2':
    'Persons / identity come from Image 1. Pose, action, and body energy come from Image 2 (extras for wardrobe/scene when present).',
};

export function normalizeComposeTransferRecipe(value: unknown): ComposeTransferRecipe {
  if (value === 'people-from-1-pose-from-2') {
    return value;
  }
  return 'pose-from-1-people-from-rest';
}

export function composeTransferRoleForIndex(
  index: number,
  recipe: ComposeTransferRecipe
): { role: string; focus: 'subject' | 'full' } {
  if (recipe === 'people-from-1-pose-from-2') {
    if (index === 1) {
      return { role: 'primary', focus: 'subject' };
    }
    if (index === 2) {
      return { role: 'structure', focus: 'subject' };
    }
    return { role: 'reference', focus: 'full' };
  }
  if (index === 1) {
    return { role: 'structure', focus: 'subject' };
  }
  return { role: 'primary', focus: 'subject' };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? trimmed).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseComposeTransferInstruction(text: string): string {
  const cleaned = stripPromptArtifacts(text).trim();
  const json = extractJsonObject(cleaned);
  if (json && typeof json.prompt === 'string' && json.prompt.trim()) {
    return stripPromptArtifacts(json.prompt).trim();
  }
  return cleaned.replace(/^["']|["']$/g, '').trim();
}

/** Deterministic fallback when the synthesis LLM is unavailable. */
export function fallbackComposeTransferInstruction(
  parts: ComposeTransferScanPart[],
  recipe: ComposeTransferRecipe
): string {
  const byIndex = new Map(parts.map(part => [part.index, part.prompt.trim()] as const));
  const img1 = byIndex.get(1);
  const rest = parts
    .filter(part => part.index > 1)
    .map(part => `Image ${part.index}`)
    .join(' and ');

  if (recipe === 'people-from-1-pose-from-2') {
    const poseSrc = parts.find(part => part.index === 2);
    return [
      'Keep the person(s) and identity from Image 1',
      img1 ? `(${truncateNote(img1)})` : '',
      poseSrc
        ? `. Match the pose and body energy from Image 2 (${truncateNote(poseSrc.prompt)})`
        : rest
          ? `. Match pose and scene cues from ${rest}`
          : '',
      '.',
    ]
      .filter(Boolean)
      .join('')
      .replace(/\s+\./g, '.');
  }

  return [
    'Use the pose, action, and framing from Image 1',
    img1 ? ` (${truncateNote(img1)})` : '',
    rest ? `. Replace the person(s) with the people from ${rest}, matching lighting and scale` : '',
    '.',
  ]
    .filter(Boolean)
    .join('')
    .replace(/\s+\./g, '.');
}

function truncateNote(value: string, max = 110): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

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
          role === 'structure'
            ? 'Emphasize pose, body language, limb placement, and camera framing.'
            : role === 'primary'
              ? 'Emphasize who the person(s) are — face, hair, body, clothes, identity cues.'
              : 'Note wardrobe, environment, or mood that should transfer.',
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
- Recipe: ${RECIPE_GUIDANCE[recipe]}
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
