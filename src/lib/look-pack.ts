/**
 * Moodboard → Fitting / Day look pack handoff.
 * Session-scoped; optional wardrobe lock + vibe notes travel via query + sessionStorage.
 */

import type { DaySlot } from './day-planner';
import type { MoodboardTemplateId, MoodboardTile, MoodboardTileRole } from './moodboard-scene';
import type { RoleplayTone } from './roleplay';
import { normalizeRoleplayTone } from './roleplay';
import type { RoleplayToolCache } from './settings-cache';

export const LOOK_PACK_KEY = 'moodboard-look-pack-v1';

export type LookPackSource = 'moodboard' | 'saved';

export type LookPack = {
  version: 1;
  source: LookPackSource;
  characterId?: string;
  templateId?: MoodboardTemplateId;
  paletteNotes?: string;
  lightingNotes?: string;
  locationNotes?: string;
  styleNotes?: string;
  moodNotes?: string;
  wardrobeId?: string;
  instruction?: string;
  vibePrompt?: string;
  tileSummaries?: Array<{
    role: MoodboardTileRole;
    notes?: string;
    imageFilename?: string;
  }>;
  savedAt: number;
};

function readText(value: unknown, max = 480): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function notesForRole(tiles: MoodboardTile[], role: MoodboardTileRole): string | undefined {
  const parts = tiles
    .filter(tile => tile.role === role)
    .map(tile => {
      const label = tile.label?.trim();
      const notes = tile.notes?.trim();
      if (label && notes) {
        return `${label}: ${notes}`;
      }
      return notes || label || '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('; ').slice(0, 480) : undefined;
}

/** Build a look pack from moodboard tiles + optional vision / synthesized vibe text. */
export function buildLookPackFromMoodboard(input: {
  tiles: MoodboardTile[];
  templateId?: MoodboardTemplateId;
  characterId?: string;
  instruction?: string;
  vibePrompt?: string;
  wardrobeId?: string;
  savedAt?: number;
}): LookPack {
  const tiles = input.tiles ?? [];
  return {
    version: 1,
    source: 'moodboard',
    characterId: readText(input.characterId, 120) || undefined,
    templateId: input.templateId,
    paletteNotes: notesForRole(tiles, 'palette'),
    lightingNotes: notesForRole(tiles, 'lighting'),
    locationNotes: notesForRole(tiles, 'location'),
    styleNotes: notesForRole(tiles, 'style'),
    moodNotes: notesForRole(tiles, 'mood'),
    wardrobeId: readText(input.wardrobeId, 120) || undefined,
    instruction: readText(input.instruction, 480) || undefined,
    vibePrompt: readText(input.vibePrompt, 2400) || undefined,
    tileSummaries: tiles.map(tile => ({
      role: tile.role,
      notes: readText(tile.notes, 320) || undefined,
      imageFilename: readText(tile.imageFilename, 240) || undefined,
    })),
    savedAt: input.savedAt ?? Date.now(),
  };
}

export function normalizeLookPack(value: unknown): LookPack | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<LookPack>;
  if (raw.version !== 1 || (raw.source !== 'moodboard' && raw.source !== 'saved')) {
    return null;
  }
  const tileSummaries = Array.isArray(raw.tileSummaries)
    ? raw.tileSummaries
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
          role: (entry as { role?: MoodboardTileRole }).role ?? ('other' as MoodboardTileRole),
          notes: readText((entry as { notes?: string }).notes, 320) || undefined,
          imageFilename:
            readText((entry as { imageFilename?: string }).imageFilename, 240) || undefined,
        }))
    : undefined;
  return {
    version: 1,
    source: raw.source === 'saved' ? 'saved' : 'moodboard',
    characterId: readText(raw.characterId, 120) || undefined,
    templateId: raw.templateId,
    paletteNotes: readText(raw.paletteNotes, 480) || undefined,
    lightingNotes: readText(raw.lightingNotes, 480) || undefined,
    locationNotes: readText(raw.locationNotes, 480) || undefined,
    styleNotes: readText(raw.styleNotes, 480) || undefined,
    moodNotes: readText(raw.moodNotes, 480) || undefined,
    wardrobeId: readText(raw.wardrobeId, 120) || undefined,
    instruction: readText(raw.instruction, 480) || undefined,
    vibePrompt: readText(raw.vibePrompt, 2400) || undefined,
    tileSummaries,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
  };
}

export function saveLookPack(pack: LookPack): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(LOOK_PACK_KEY, JSON.stringify(pack));
}

export function loadLookPack(options?: { clear?: boolean }): LookPack | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(LOOK_PACK_KEY);
    if (!raw) {
      return null;
    }
    const pack = normalizeLookPack(JSON.parse(raw) as unknown);
    if (options?.clear) {
      window.sessionStorage.removeItem(LOOK_PACK_KEY);
    }
    return pack;
  } catch {
    window.sessionStorage.removeItem(LOOK_PACK_KEY);
    return null;
  }
}

export function clearLookPack(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(LOOK_PACK_KEY);
}

/**
 * Reuse a staged Moodboard pack only when it belongs to the active Cast
 * (or both sides are anonymous). Never stamp another character's look onto a new one.
 */
export function canReuseStagedLookPack(
  staged: LookPack | null | undefined,
  characterId?: string | null
): boolean {
  if (!staged) {
    return false;
  }
  const hasContent = Boolean(
    staged.vibePrompt?.trim() || staged.instruction?.trim() || staged.moodNotes?.trim()
  );
  if (!hasContent) {
    return false;
  }
  const stagedId = staged.characterId?.trim() || '';
  const activeId = characterId?.trim() || '';
  if (!activeId && !stagedId) {
    return true;
  }
  return Boolean(activeId && stagedId && activeId === stagedId);
}

/** Combined notes string for Fitting / Day tool notes fields. */
export function lookPackNotes(pack: LookPack): string {
  return [
    pack.vibePrompt,
    pack.instruction,
    pack.moodNotes ? `mood: ${pack.moodNotes}` : null,
    pack.lightingNotes ? `lighting: ${pack.lightingNotes}` : null,
    pack.paletteNotes ? `palette: ${pack.paletteNotes}` : null,
    pack.styleNotes ? `style: ${pack.styleNotes}` : null,
    pack.locationNotes ? `location: ${pack.locationNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1200);
}

/** Seed Fitting shared + tool notes from a look pack (`?from=look` handoff). */
export function applyLookPackToFittingState(pack: LookPack): {
  shared: { lockedWardrobeId?: string };
  tool: { notes?: string };
} {
  const notes = lookPackNotes(pack).slice(0, 1200) || undefined;
  return {
    shared: {
      ...(pack.wardrobeId?.trim() ? { lockedWardrobeId: pack.wardrobeId.trim() } : {}),
    },
    tool: {
      ...(notes ? { notes } : {}),
    },
  };
}

export function lookPackFittingHref(pack: LookPack): string {
  const params = new URLSearchParams();
  params.set('from', 'look');
  if (pack.characterId) {
    params.set('character', pack.characterId);
  }
  if (pack.wardrobeId) {
    params.set('wardrobe', pack.wardrobeId);
  }
  return `/fitting?${params.toString()}`;
}

export function lookPackDayHref(pack: LookPack): string {
  const params = new URLSearchParams();
  params.set('from', 'look');
  if (pack.characterId) {
    params.set('character', pack.characterId);
  }
  if (pack.wardrobeId) {
    params.set('wardrobe', pack.wardrobeId);
  }
  return `/day?${params.toString()}`;
}

export function lookPackRoleplayHref(pack: LookPack): string {
  const params = new URLSearchParams();
  params.set('from', 'look');
  if (pack.characterId) {
    params.set('character', pack.characterId);
  }
  if (pack.wardrobeId) {
    params.set('wardrobe', pack.wardrobeId);
  }
  return `/roleplay?${params.toString()}`;
}

const TONE_FROM_MOOD: Array<{ pattern: RegExp; tone: RoleplayTone }> = [
  { pattern: /\bnoir\b/i, tone: 'noir' },
  { pattern: /\bcozy\b|\bwarm\b|\bsoft\b/i, tone: 'cozy' },
  { pattern: /\bromantic\b|\blove\b/i, tone: 'romantic' },
  { pattern: /\bhorror\b|\bscary\b|\bcreepy\b/i, tone: 'horror' },
  { pattern: /\bepic\b|\bgrand\b|\bheroic\b/i, tone: 'epic' },
  { pattern: /\bdreamy\b|\bsoft focus\b|\bethereal\b/i, tone: 'dreamy' },
  { pattern: /\bgritty\b|\braw\b|\bstreet\b/i, tone: 'gritty' },
  { pattern: /\bmelanchol\b|\bsad\b|\blonely\b/i, tone: 'melancholy' },
  { pattern: /\bchaotic\b|\bwild\b|\bunhinged\b/i, tone: 'chaotic' },
  { pattern: /\bcinematic\b|\bdramatic\b|\bfilm\b/i, tone: 'cinematic' },
  { pattern: /\bdeadpan\b|\bdry\b/i, tone: 'deadpan' },
];

/** Best-effort tone from moodboard mood / vibe text. */
export function inferRoleplayToneFromLookPack(pack: LookPack): RoleplayTone | undefined {
  const haystack = [pack.moodNotes, pack.vibePrompt, pack.instruction, pack.styleNotes]
    .filter(Boolean)
    .join(' ');
  if (!haystack.trim()) {
    return undefined;
  }
  for (const entry of TONE_FROM_MOOD) {
    if (entry.pattern.test(haystack)) {
      return entry.tone;
    }
  }
  return undefined;
}

/** Map a look pack onto Roleplay tool settings + shared wardrobe lock. */
export function applyLookPackToRoleplaySettings(pack: LookPack): {
  tool: Partial<RoleplayToolCache>;
  shared: { lockedWardrobeId?: string; lockedLocation?: string };
} {
  const setting =
    pack.locationNotes?.trim() ||
    [pack.lightingNotes, pack.paletteNotes].filter(Boolean).join(' · ').slice(0, 240) ||
    undefined;
  const extraHints = lookPackNotes(pack).slice(0, 1200) || undefined;
  const tone = inferRoleplayToneFromLookPack(pack);
  return {
    tool: {
      ...(setting ? { setting } : {}),
      ...(extraHints ? { extraHints } : {}),
      ...(tone ? { tone: normalizeRoleplayTone(tone) } : {}),
    },
    shared: {
      ...(pack.wardrobeId?.trim() ? { lockedWardrobeId: pack.wardrobeId.trim() } : {}),
      ...(pack.locationNotes?.trim() ? { lockedLocation: pack.locationNotes.trim() } : {}),
    },
  };
}

export function lookPackPlayCampaignHref(characterId: string, lookPackId?: string): string {
  const params = new URLSearchParams();
  params.set('character', characterId);
  if (lookPackId?.trim()) {
    params.set('lookPack', lookPackId.trim());
  }
  return `/play?${params.toString()}`;
}

/** Portable JSON for share / import (Cast look packs + session packs). */
export const PORTABLE_LOOK_PACK_KIND = 'prompt-studio-look-pack' as const;

export type PortableLookPack = {
  version: 1;
  kind: typeof PORTABLE_LOOK_PACK_KIND;
  name?: string;
  id?: string;
  pack: LookPack;
};

export function buildPortableLookPack(input: {
  pack: LookPack;
  name?: string;
  id?: string;
}): PortableLookPack {
  return {
    version: 1,
    kind: PORTABLE_LOOK_PACK_KIND,
    name: readText(input.name, 120) || undefined,
    id: readText(input.id, 120) || undefined,
    pack: {
      ...input.pack,
      source: input.pack.source === 'saved' ? 'saved' : 'moodboard',
    },
  };
}

export function normalizePortableLookPack(value: unknown): PortableLookPack | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<PortableLookPack> & { pack?: unknown };
  if (raw.version !== 1 || raw.kind !== PORTABLE_LOOK_PACK_KIND) {
    // Accept a bare LookPack for convenience (export from older sessions).
    const bare = normalizeLookPack(value);
    if (bare) {
      return buildPortableLookPack({ pack: bare });
    }
    return null;
  }
  const pack = normalizeLookPack(raw.pack);
  if (!pack) {
    return null;
  }
  return buildPortableLookPack({
    pack,
    name: raw.name,
    id: raw.id,
  });
}

function triggerLookPackDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugLookPackFilenamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'look'
  );
}

/** Download a portable look-pack JSON file for sharing across machines. */
export function downloadLookPackFile(input: { pack: LookPack; name?: string; id?: string }): void {
  const portable = buildPortableLookPack(input);
  const label = portable.name || portable.pack.characterId || 'look-pack';
  const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
  triggerLookPackDownload(blob, `look-pack-${slugLookPackFilenamePart(label)}.json`);
}

export async function parseLookPackFile(file: File): Promise<PortableLookPack | null> {
  try {
    const text = await file.text();
    return normalizePortableLookPack(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** Hash fragment key for cross-machine portable look-pack share links. */
export const LOOK_PACK_SHARE_HASH_KEY = 'lookpack';

/** Rough max base64url token length for `#lookpack=` (browser URL limits). */
export const LOOK_PACK_SHARE_MAX_TOKEN_CHARS = 12_000;

export type PortableLookPackShareLink = {
  href: string;
  tokenChars: number;
  tooLarge: boolean;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): Uint8Array | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const base64 = padded + pad;
    const binary =
      typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Encode a portable look pack for `/play#lookpack=…` share URLs. */
export function encodePortableLookPackShareToken(portable: PortableLookPack): string {
  const normalized =
    normalizePortableLookPack(portable) ??
    buildPortableLookPack({
      pack: portable.pack,
      name: portable.name,
      id: portable.id,
    });
  const json = JSON.stringify(normalized);
  if (typeof TextEncoder !== 'undefined') {
    return toBase64Url(new TextEncoder().encode(json));
  }
  return toBase64Url(Uint8Array.from(Buffer.from(json, 'utf8')));
}

/** Decode a `#lookpack=` share token (or raw base64url payload). */
export function decodePortableLookPackShareToken(token: string): PortableLookPack | null {
  const raw = token.trim();
  if (!raw) {
    return null;
  }
  const bytes = fromBase64Url(raw);
  if (!bytes) {
    return null;
  }
  try {
    const json =
      typeof TextDecoder !== 'undefined'
        ? new TextDecoder().decode(bytes)
        : Buffer.from(bytes).toString('utf8');
    return normalizePortableLookPack(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

/** Cross-machine Play share URL embedding the full portable look pack in the hash. */
export function buildPortableLookPackShareLink(input: {
  pack: LookPack;
  name?: string;
  id?: string;
}): PortableLookPackShareLink {
  const portable = buildPortableLookPack(input);
  const token = encodePortableLookPackShareToken(portable);
  return {
    href: `/play#${LOOK_PACK_SHARE_HASH_KEY}=${token}`,
    tokenChars: token.length,
    tooLarge: token.length > LOOK_PACK_SHARE_MAX_TOKEN_CHARS,
  };
}

export function lookPackPortableShareHref(input: {
  pack: LookPack;
  name?: string;
  id?: string;
}): string {
  return buildPortableLookPackShareLink(input).href;
}

export async function copyPortableLookPackShareLink(input: {
  pack: LookPack;
  name?: string;
  id?: string;
  origin?: string;
}): Promise<{ ok: boolean; tooLarge: boolean; href: string; error?: string }> {
  const built = buildPortableLookPackShareLink(input);
  if (built.tooLarge) {
    return { ok: false, tooLarge: true, href: built.href };
  }
  const absolute =
    typeof window !== 'undefined'
      ? `${input.origin ?? window.location.origin}${built.href}`
      : built.href;
  try {
    await navigator.clipboard.writeText(absolute);
    return { ok: true, tooLarge: false, href: absolute };
  } catch (err) {
    return {
      ok: false,
      tooLarge: false,
      href: absolute,
      error: err instanceof Error ? err.message : 'Could not copy link.',
    };
  }
}

/** Read a portable look pack from a location hash (`#lookpack=…`). */
export function readPortableLookPackFromHash(
  hash: string = typeof window !== 'undefined' ? window.location.hash : ''
): PortableLookPack | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const token = params.get(LOOK_PACK_SHARE_HASH_KEY)?.trim();
  if (!token) {
    // Also accept bare `#lookpack=<token>` without URLSearchParams edge cases.
    const prefix = `${LOOK_PACK_SHARE_HASH_KEY}=`;
    if (raw.startsWith(prefix)) {
      return decodePortableLookPackShareToken(raw.slice(prefix.length));
    }
    return null;
  }
  return decodePortableLookPackShareToken(token);
}

/** Clear the look-pack share hash without a navigation. */
export function clearLookPackShareHash(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}`);
}

/** Seed every Day slot location / beat from a look pack (wardrobe only when empty). */
export function applyLookPackToDaySlots(slots: DaySlot[], pack: LookPack): DaySlot[] {
  const location = pack.locationNotes?.trim();
  const beatParts = [
    pack.moodNotes,
    pack.lightingNotes,
    pack.paletteNotes,
    pack.styleNotes,
    pack.instruction,
  ]
    .map(part => part?.trim())
    .filter(Boolean);
  const beat = beatParts.join(' · ').slice(0, 320) || undefined;
  const wardrobeId = pack.wardrobeId?.trim();

  return slots.map(slot => ({
    ...slot,
    location: location || slot.location,
    sceneHints: beat || slot.sceneHints,
    wardrobeId: slot.wardrobeId?.trim() || wardrobeId || undefined,
  }));
}
