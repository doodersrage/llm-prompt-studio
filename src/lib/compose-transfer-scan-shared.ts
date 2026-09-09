/**
 * Client-safe Compose transfer-scan helpers (no Node / LLM / sharp).
 */

import { stripPromptArtifacts } from '@/lib/prompt-cleanup';

export const COMPOSE_TRANSFER_RECIPE_IDS = [
  'pose-from-1-people-from-rest',
  'people-from-1-pose-from-2',
  'outfit-from-2',
  'background-from-2',
  'style-from-2',
  'hair-from-2',
  'expression-from-2',
] as const;

export type ComposeTransferRecipe = (typeof COMPOSE_TRANSFER_RECIPE_IDS)[number];

export type ComposeTransferScanPart = {
  index: number;
  role: string;
  prompt: string;
};

export type ComposeTransferRecipeOption = {
  id: ComposeTransferRecipe;
  label: string;
  title: string;
  guidance: string;
};

/** UI chips + synthesis guidance — keep in one place. */
export const COMPOSE_TRANSFER_RECIPE_OPTIONS: ComposeTransferRecipeOption[] = [
  {
    id: 'pose-from-1-people-from-rest',
    label: 'Pose ← 1 · People ← 2+',
    title: 'Pose and framing from Image 1; persons / identity from Images 2–4',
    guidance:
      'Pose, action, and framing come from Image 1. Persons / identity / look come from Image 2+ (and later images for wardrobe or scene when present).',
  },
  {
    id: 'people-from-1-pose-from-2',
    label: 'People ← 1 · Pose ← 2',
    title: 'Persons from Image 1; pose and body energy from Image 2',
    guidance:
      'Persons / identity come from Image 1. Pose, action, and body energy come from Image 2 (extras for wardrobe/scene when present).',
  },
  {
    id: 'outfit-from-2',
    label: 'Outfit ← 2',
    title: 'Keep person and pose from Image 1; transfer outfit / clothes from Image 2',
    guidance:
      'Keep identity, face, body, and pose from Image 1. Replace clothing with the outfit / garment style from Image 2 (later images can add accessories). Match lighting and fabric drape.',
  },
  {
    id: 'background-from-2',
    label: 'Background ← 2',
    title: 'Keep the person from Image 1; replace the scene with Image 2',
    guidance:
      'Keep the person(s) from Image 1 unchanged in identity, pose, and proportions. Replace the background / environment with the scene from Image 2 (extras for props or atmosphere). Match perspective and lighting.',
  },
  {
    id: 'style-from-2',
    label: 'Style / light ← 2',
    title: 'Keep content from Image 1; transfer lighting, grade, and look from Image 2',
    guidance:
      'Keep subjects, pose, and composition from Image 1. Apply lighting direction, contrast, color grade, and overall photographic / illustrative look from Image 2 without inventing new people.',
  },
  {
    id: 'hair-from-2',
    label: 'Hair ← 2',
    title: 'Keep face and pose from Image 1; apply hair from Image 2',
    guidance:
      'Keep face identity, pose, and body from Image 1. Apply hair style, length, and color from Image 2 with natural roots and lighting match.',
  },
  {
    id: 'expression-from-2',
    label: 'Expression ← 2',
    title: 'Keep identity and pose from Image 1; transfer facial expression from Image 2',
    guidance:
      'Keep identity, body pose, and outfit from Image 1. Apply facial expression and gaze direction from Image 2 without changing bone structure.',
  },
];

export const COMPOSE_TRANSFER_RECIPE_GUIDANCE: Record<ComposeTransferRecipe, string> =
  Object.fromEntries(
    COMPOSE_TRANSFER_RECIPE_OPTIONS.map(option => [option.id, option.guidance])
  ) as Record<ComposeTransferRecipe, string>;

const RECIPE_SET = new Set<string>(COMPOSE_TRANSFER_RECIPE_IDS);

export function normalizeComposeTransferRecipe(value: unknown): ComposeTransferRecipe {
  if (typeof value === 'string' && RECIPE_SET.has(value)) {
    return value as ComposeTransferRecipe;
  }
  return 'pose-from-1-people-from-rest';
}

/** Per-slot scan role + framing for vision describe. */
export function composeTransferRoleForIndex(
  index: number,
  recipe: ComposeTransferRecipe
): { role: string; focus: 'subject' | 'full' } {
  switch (recipe) {
    case 'people-from-1-pose-from-2':
      if (index === 1) return { role: 'primary', focus: 'subject' };
      if (index === 2) return { role: 'structure', focus: 'subject' };
      return { role: 'reference', focus: 'full' };
    case 'outfit-from-2':
      if (index === 1) return { role: 'primary', focus: 'subject' };
      return { role: 'wardrobe', focus: 'subject' };
    case 'background-from-2':
      if (index === 1) return { role: 'primary', focus: 'subject' };
      return { role: 'environment', focus: 'full' };
    case 'style-from-2':
      if (index === 1) return { role: 'primary', focus: 'full' };
      return { role: 'look', focus: 'full' };
    case 'hair-from-2':
      if (index === 1) return { role: 'primary', focus: 'subject' };
      return { role: 'hair', focus: 'subject' };
    case 'expression-from-2':
      if (index === 1) return { role: 'primary', focus: 'subject' };
      return { role: 'expression', focus: 'subject' };
    case 'pose-from-1-people-from-rest':
    default:
      if (index === 1) return { role: 'structure', focus: 'subject' };
      return { role: 'primary', focus: 'subject' };
  }
}

/** Extra vision hint layered on top of the generic role text. */
export function composeTransferVisionHintForRole(role: string): string {
  switch (role) {
    case 'structure':
      return 'Emphasize pose, body language, limb placement, and camera framing.';
    case 'primary':
      return 'Emphasize who the person(s) are — face, hair, body, clothes, identity cues.';
    case 'wardrobe':
      return 'Emphasize clothing: cut, layers, colors, fabric, footwear, and accessories.';
    case 'environment':
      return 'Emphasize setting, background, architecture, landscape, and ambient light — not faces.';
    case 'look':
      return 'Emphasize lighting direction, contrast, color grade, grain, and overall photographic style.';
    case 'hair':
      return 'Emphasize hair style, length, color, parting, and texture.';
    case 'expression':
      return 'Emphasize facial expression, mouth, eyes, brows, and gaze direction.';
    default:
      return 'Note wardrobe, environment, or mood that should transfer.';
  }
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

function noteFor(parts: ComposeTransferScanPart[], index: number): string {
  const part = parts.find(entry => entry.index === index);
  return part ? truncateNote(part.prompt) : '';
}

function donorLabel(parts: ComposeTransferScanPart[]): string {
  return parts
    .filter(part => part.index > 1)
    .map(part => `Image ${part.index}`)
    .join(' and ');
}

/** Deterministic fallback when the synthesis LLM is unavailable. */
export function fallbackComposeTransferInstruction(
  parts: ComposeTransferScanPart[],
  recipe: ComposeTransferRecipe
): string {
  const img1 = noteFor(parts, 1);
  const img2 = noteFor(parts, 2);
  const rest = donorLabel(parts);

  switch (recipe) {
    case 'people-from-1-pose-from-2':
      return joinSentence([
        'Keep the person(s) and identity from Image 1',
        img1 ? `(${img1})` : '',
        img2
          ? `. Match the pose and body energy from Image 2 (${img2})`
          : rest
            ? `. Match pose and scene cues from ${rest}`
            : '',
      ]);
    case 'outfit-from-2':
      return joinSentence([
        'Keep identity, face, and pose from Image 1',
        img1 ? `(${img1})` : '',
        img2
          ? `. Replace the outfit with the clothing from Image 2 (${img2})`
          : rest
            ? `. Replace the outfit using clothes from ${rest}`
            : '',
        ', matching lighting and fabric drape',
      ]);
    case 'background-from-2':
      return joinSentence([
        'Keep the person(s) from Image 1 unchanged in identity, pose, and proportions',
        img1 ? `(${img1})` : '',
        img2
          ? `. Replace the background with the environment from Image 2 (${img2})`
          : rest
            ? `. Replace the background using ${rest}`
            : '',
        ', matching perspective and lighting',
      ]);
    case 'style-from-2':
      return joinSentence([
        'Keep subjects, pose, and composition from Image 1',
        img1 ? `(${img1})` : '',
        img2
          ? `. Apply lighting, color grade, and look from Image 2 (${img2})`
          : rest
            ? `. Apply lighting and look cues from ${rest}`
            : '',
        ' without changing who is in the frame',
      ]);
    case 'hair-from-2':
      return joinSentence([
        'Keep face identity, pose, and body from Image 1',
        img1 ? `(${img1})` : '',
        img2
          ? `. Apply the hair style, length, and color from Image 2 (${img2})`
          : rest
            ? `. Apply hair cues from ${rest}`
            : '',
        ' with natural roots and lighting match',
      ]);
    case 'expression-from-2':
      return joinSentence([
        'Keep identity, body pose, and outfit from Image 1',
        img1 ? `(${img1})` : '',
        img2
          ? `. Apply the facial expression and gaze from Image 2 (${img2})`
          : rest
            ? `. Apply expression cues from ${rest}`
            : '',
        ' without changing bone structure',
      ]);
    case 'pose-from-1-people-from-rest':
    default:
      return joinSentence([
        'Use the pose, action, and framing from Image 1',
        img1 ? `(${img1})` : '',
        rest
          ? `. Replace the person(s) with the people from ${rest}, matching lighting and scale`
          : '',
      ]);
  }
}

function joinSentence(chunks: string[]): string {
  return chunks
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .trim()
    .replace(/[^.!?]$/, m => `${m}.`);
}

function truncateNote(value: string, max = 110): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}
