/**
 * Character OS — one character record for Generate, Roleplay, Compose, Video, and LoRA export.
 * Absorbs identity bundles, session IP-Adapter lock, and Roleplay cast fields.
 */

import {
  BROWSER_STORAGE_HEALTH_EVENT,
  readBrowserValue,
  writeBrowserValue,
} from './browser-storage';
import type { CharacterFilmCut } from './character-film';
import type { CharacterIdentityBundle } from './character-identity-bundle';
import type { LookPack } from './look-pack';
import {
  applyCharacterIdentityBundle,
  buildCharacterIdentityBundle,
} from './character-identity-bundle';
import { normalizeComposeIdentityKind } from './compose-identity-lock';
import type { RoleplayLibrarySession } from './roleplay-library';
import type { RoleplayBio, RoleplayContentId, RoleplayPlayAs, RoleplayTone } from './roleplay';
import { loadSettingsCache, saveSharedSettings, type SharedToolSettings } from './settings-cache';

export const CHARACTERS_KEY = 'comfy-prompt-characters-v1';
export const CHARACTERS_UPDATED_EVENT = 'prompt-studio-characters-updated';
export const MAX_CHARACTERS = 48;
export const MAX_LOOKS = 24;
export const MAX_LOOK_PACKS = 16;

export type CharacterLookPack = {
  id: string;
  name: string;
  savedAt: number;
  pack: LookPack;
};

export type CharacterRecord = {
  id: string;
  name: string;
  version: 1;
  updatedAt: number;
  /** Active look id — switching looks must not destroy prior ones. */
  activeLookId?: string;
  looks?: CharacterLook[];
  /** LoRA library ids pinned to this character (session stack on apply). */
  loraLibraryIds?: string[];
  descriptor?: string;
  hints?: string;
  bio?: RoleplayBio;
  ipAdapter?: {
    imageFilename?: string;
    imageFilenames?: string[];
    imageUrl?: string;
    comfyUrl?: string;
    strength?: number;
    modelFilename?: string;
    kind?: SharedToolSettings['identityKind'];
  };
  reference?: {
    originalUrl?: string;
    originalFilename?: string;
    isolatedUrl?: string;
    isolatedFilename?: string;
    isolated?: boolean;
    isolateSubject?: boolean;
  };
  lockedWardrobeId?: string;
  lockedLocation?: string;
  lockedVariationSeed?: string;
  alwaysIncludeClothing?: boolean;
  model?: string;
  detail?: SharedToolSettings['detail'];
  negativeProfileId?: string;
  loraTriggerPhrases?: string[];
  personaId?: string;
  customPersona?: string;
  characterName?: string;
  setting?: string;
  tone?: RoleplayTone;
  content?: RoleplayContentId;
  playAs?: RoleplayPlayAs;
  notes?: string;
  /** Watch/cut list for assembling a film from this character's clips and stills. */
  filmCut?: CharacterFilmCut;
  /** Named Moodboard look packs saved on this character. */
  lookPacks?: CharacterLookPack[];
};

export type CharacterLook = {
  id: string;
  name: string;
  createdAt: number;
  descriptor?: string;
  hints?: string;
  ipAdapter?: CharacterRecord['ipAdapter'];
  reference?: CharacterRecord['reference'];
  lockedWardrobeId?: string;
  lockedLocation?: string;
  lockedVariationSeed?: string;
  alwaysIncludeClothing?: boolean;
  model?: string;
  detail?: SharedToolSettings['detail'];
  negativeProfileId?: string;
  /** Gallery still ids marked as LoRA keepers for this era. Undefined = fall back to favorites. */
  keeperEntryIds?: string[];
};

type CharacterStore = {
  version: 1;
  migratedFromBundles: boolean;
  characters: CharacterRecord[];
  /** Ids dropped from Cast — migrate must not resurrect them from Roleplay archives. */
  removedIds?: string[];
};

const EMPTY_CHARACTERS: CharacterRecord[] = [];
let charactersSnapshot: CharacterRecord[] = EMPTY_CHARACTERS;
let charactersSnapshotKey = '';

function charactersSnapshotKeyFor(characters: CharacterRecord[]): string {
  return characters.map(character => `${character.id}:${character.updatedAt}`).join('|');
}

function cacheCharactersSnapshot(characters: CharacterRecord[]): CharacterRecord[] {
  const key = charactersSnapshotKeyFor(characters);
  if (key === charactersSnapshotKey) {
    return charactersSnapshot;
  }
  charactersSnapshotKey = key;
  charactersSnapshot = characters;
  return charactersSnapshot;
}

function notifyCharactersUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(new Event(CHARACTERS_UPDATED_EVENT));
}

/** Stable list for React `useSyncExternalStore` — same reference until the store changes. */
export function getCharactersSnapshot(): CharacterRecord[] {
  return cacheCharactersSnapshot(readStore().characters);
}

export function getServerCharactersSnapshot(): CharacterRecord[] {
  return EMPTY_CHARACTERS;
}

export function subscribeCharacters(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener(CHARACTERS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(BROWSER_STORAGE_HEALTH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(CHARACTERS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(BROWSER_STORAGE_HEALTH_EVENT, onStoreChange);
  };
}

function newCharacterId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `char-${crypto.randomUUID()}`;
  }
  return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newLookId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `look-${crypto.randomUUID()}`;
  }
  return `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newLookPackId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `lp-${crypto.randomUUID()}`;
  }
  return `lp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLookPacks(input: CharacterLookPack[] | undefined): CharacterLookPack[] {
  const next: CharacterLookPack[] = [];
  for (const entry of input ?? []) {
    if (!entry?.id || !entry.pack || entry.pack.version !== 1) {
      continue;
    }
    const name = readName(entry.name) || 'Look pack';
    next.push({
      id: entry.id.trim(),
      name,
      savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : Date.now(),
      pack: {
        ...entry.pack,
        source: entry.pack.source === 'saved' ? 'saved' : 'moodboard',
        characterId: entry.pack.characterId?.trim() || undefined,
      },
    });
  }
  return next.sort((left, right) => right.savedAt - left.savedAt).slice(0, MAX_LOOK_PACKS);
}

export function lookPacksOf(character: CharacterRecord): CharacterLookPack[] {
  return normalizeLookPacks(character.lookPacks);
}

export function getCharacterLookPack(
  characterId: string,
  lookPackId: string
): CharacterLookPack | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const id = lookPackId.trim();
  return lookPacksOf(character).find(entry => entry.id === id);
}

export function addCharacterLookPack(
  characterId: string,
  name: string,
  pack: LookPack
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character || pack.version !== 1) {
    return character;
  }
  const label = readName(name) || 'Look pack';
  const saved: LookPack = {
    ...pack,
    source: 'saved',
    characterId: character.id,
    savedAt: Date.now(),
  };
  const entry: CharacterLookPack = {
    id: newLookPackId(),
    name: label,
    savedAt: saved.savedAt,
    pack: saved,
  };
  const existing = lookPacksOf(character);
  upsertCharacter({
    ...character,
    looks: looksOf(character),
    lookPacks: [entry, ...existing.filter(item => item.name !== label)].slice(0, MAX_LOOK_PACKS),
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function removeCharacterLookPack(
  characterId: string,
  lookPackId: string
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  const id = lookPackId.trim();
  if (!character || !id) {
    return character;
  }
  upsertCharacter({
    ...character,
    looks: looksOf(character),
    lookPacks: lookPacksOf(character).filter(entry => entry.id !== id),
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function characterHomeHref(id: string): string {
  return `/characters/${encodeURIComponent(id.trim())}`;
}

function uniqueIds(ids: string[] | undefined): string[] | undefined {
  const next = [...new Set((ids ?? []).map(id => id.trim()).filter(Boolean))];
  return next.length > 0 ? next : undefined;
}

export function lookFromAppearance(
  source: Pick<
    CharacterRecord,
    | 'descriptor'
    | 'hints'
    | 'ipAdapter'
    | 'reference'
    | 'lockedWardrobeId'
    | 'lockedLocation'
    | 'lockedVariationSeed'
    | 'alwaysIncludeClothing'
    | 'model'
    | 'detail'
    | 'negativeProfileId'
  > & {
    keeperEntryIds?: string[];
  },
  name: string,
  id?: string,
  createdAt?: number
): CharacterLook {
  return {
    id: id?.trim() || newLookId(),
    name: readName(name) || 'Default',
    createdAt: createdAt ?? Date.now(),
    descriptor: source.descriptor,
    hints: source.hints,
    ipAdapter: source.ipAdapter,
    reference: source.reference,
    lockedWardrobeId: source.lockedWardrobeId,
    lockedLocation: source.lockedLocation,
    lockedVariationSeed: source.lockedVariationSeed,
    alwaysIncludeClothing: source.alwaysIncludeClothing,
    model: source.model,
    detail: source.detail,
    negativeProfileId: source.negativeProfileId,
    keeperEntryIds: uniqueIds(source.keeperEntryIds),
  };
}

function applyLookFields(character: CharacterRecord, look: CharacterLook): CharacterRecord {
  return {
    ...character,
    activeLookId: look.id,
    descriptor: look.descriptor,
    hints: look.hints,
    ipAdapter: look.ipAdapter,
    reference: look.reference,
    lockedWardrobeId: look.lockedWardrobeId,
    lockedLocation: look.lockedLocation,
    lockedVariationSeed: look.lockedVariationSeed,
    alwaysIncludeClothing: look.alwaysIncludeClothing,
    model: look.model,
    detail: look.detail,
    negativeProfileId: look.negativeProfileId,
  };
}

export function looksOf(character: CharacterRecord): CharacterLook[] {
  if (character.looks?.length) {
    const filtered = character.looks
      .filter(look => look && look.id && readName(look.name))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_LOOKS);
    // Corrupt/legacy rows can leave a non-empty looks array that filters to
    // nothing — never return [] or activeLook / normalize will throw.
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return [lookFromAppearance(character, 'Default')];
}

export function activeLook(character: CharacterRecord): CharacterLook {
  const looks = looksOf(character);
  return looks.find(look => look.id === character.activeLookId) ?? looks[0]!;
}

export function normalizeCharacterRecord(character: CharacterRecord): CharacterRecord {
  const looks = looksOf(character);
  const current = looks.find(look => look.id === character.activeLookId) ?? looks[0]!;
  return applyLookFields(
    {
      ...character,
      loraLibraryIds: uniqueIds(character.loraLibraryIds),
      looks,
      lookPacks: normalizeLookPacks(character.lookPacks),
      activeLookId: current.id,
    },
    current
  );
}

function readName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export function slugCharacterName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function characterFromBundle(bundle: CharacterIdentityBundle, id?: string): CharacterRecord {
  return {
    id: id?.trim() || newCharacterId(),
    name: bundle.name.trim(),
    version: 1,
    updatedAt: Date.parse(bundle.exportedAt) || Date.now(),
    descriptor: bundle.descriptor?.trim() || undefined,
    hints: bundle.hints?.trim() || undefined,
    ipAdapter: {
      imageFilename: bundle.ipAdapterImageFilename?.trim() || undefined,
      strength: bundle.ipAdapterStrength,
      modelFilename: bundle.ipAdapterModelFilename?.trim() || undefined,
    },
    lockedWardrobeId: bundle.lockedWardrobeId,
    lockedLocation: bundle.lockedLocation,
    lockedVariationSeed: bundle.lockedVariationSeed,
    alwaysIncludeClothing: bundle.alwaysIncludeClothing,
    model: bundle.model,
    detail: bundle.detail,
    negativeProfileId: bundle.negativeProfileId,
    loraTriggerPhrases: bundle.loraTriggerPhrases?.filter(Boolean),
    notes: bundle.notes?.trim() || undefined,
  };
}

export function bundleFromCharacter(character: CharacterRecord): CharacterIdentityBundle {
  const updatedAt = Number(character.updatedAt);
  const exportedAt = Number.isFinite(updatedAt)
    ? new Date(updatedAt).toISOString()
    : new Date().toISOString();
  return {
    version: 1,
    exportedAt,
    name: character.name,
    hints: character.hints,
    model: character.model,
    detail: character.detail,
    lockedWardrobeId: character.lockedWardrobeId,
    lockedLocation: character.lockedLocation,
    lockedVariationSeed: character.lockedVariationSeed,
    alwaysIncludeClothing: character.alwaysIncludeClothing,
    negativeProfileId: character.negativeProfileId,
    loraTriggerPhrases: character.loraTriggerPhrases,
    notes: character.notes,
    descriptor: character.descriptor,
    ipAdapterImageFilename: character.ipAdapter?.imageFilename,
    ipAdapterStrength: character.ipAdapter?.strength,
    ipAdapterModelFilename: character.ipAdapter?.modelFilename,
  };
}

export function characterFromShared(
  shared: SharedToolSettings,
  input: { name: string; hints?: string; bio?: RoleplayBio; notes?: string }
): CharacterRecord {
  const name = input.name.trim();
  return {
    id: newCharacterId(),
    name,
    version: 1,
    updatedAt: Date.now(),
    descriptor: shared.activeCharacterDescriptor?.trim() || undefined,
    hints: input.hints?.trim() || undefined,
    bio: input.bio,
    ipAdapter: {
      imageFilename: shared.ipAdapterImageFilename?.trim() || undefined,
      imageFilenames: shared.ipAdapterImageFilenames,
      imageUrl: shared.ipAdapterImageUrl?.trim() || undefined,
      comfyUrl: shared.ipAdapterComfyUrl?.trim() || undefined,
      strength: shared.ipAdapterStrength,
      modelFilename: shared.ipAdapterModelFilename?.trim() || undefined,
      kind: shared.identityKind,
    },
    lockedWardrobeId: shared.lockedWardrobeId,
    lockedLocation: shared.lockedLocation,
    lockedVariationSeed: shared.lockedVariationSeed,
    alwaysIncludeClothing: shared.alwaysIncludeClothing,
    model: shared.model,
    detail: shared.detail,
    characterName: name,
    notes: input.notes?.trim() || undefined,
  };
}

/** Fresh Cast record — name only; does not inherit the live session look. */
export function createBlankCharacter(name: string): CharacterRecord {
  const trimmed = name.trim() || 'Untitled character';
  return {
    id: newCharacterId(),
    name: trimmed,
    version: 1,
    updatedAt: Date.now(),
    characterName: trimmed,
  };
}

function omitUndefinedSettings(
  patch: Partial<SharedToolSettings> & Record<string, unknown>
): Partial<SharedToolSettings> {
  const next: Partial<SharedToolSettings> & Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next as Partial<SharedToolSettings>;
}

export function applyCharacterRecord(character: CharacterRecord): Partial<SharedToolSettings> {
  const normalized = normalizeCharacterRecord(character);
  const bundlePatch = applyCharacterIdentityBundle(bundleFromCharacter(normalized));
  return omitUndefinedSettings({
    ...bundlePatch,
    activeCharacterId: normalized.id,
    activeLookId: normalized.activeLookId,
    ipAdapterImageFilenames: normalized.ipAdapter?.imageFilenames,
    ipAdapterImageUrl: normalized.ipAdapter?.imageUrl,
    ipAdapterComfyUrl: normalized.ipAdapter?.comfyUrl,
    identityKind: normalized.ipAdapter?.kind
      ? normalizeComposeIdentityKind(normalized.ipAdapter.kind)
      : undefined,
    ...(normalized.loraLibraryIds?.length
      ? { sessionActiveLoraIds: [...normalized.loraLibraryIds] }
      : {}),
  });
}

/**
 * Activate a character and drop prior Cast identity that the record does not define
 * (face lock, wardrobe, look, session LoRAs). Use when creating a blank Cast so the
 * previous character's look does not stick to the session.
 */
export function applyCharacterRecordFresh(character: CharacterRecord): Partial<SharedToolSettings> {
  return {
    activeLookId: undefined,
    activeCharacterDescriptor: undefined,
    ipAdapterImageFilename: undefined,
    ipAdapterImageFilenames: undefined,
    ipAdapterImageUrl: undefined,
    ipAdapterComfyUrl: undefined,
    ipAdapterStrength: undefined,
    ipAdapterModelFilename: undefined,
    identityKind: undefined,
    lockedWardrobeId: undefined,
    lockedLocation: undefined,
    lockedVariationSeed: undefined,
    alwaysIncludeClothing: undefined,
    sessionActiveLoraIds: undefined,
    ...applyCharacterRecord(character),
  };
}

export function characterFromRoleplaySession(
  session: RoleplayLibrarySession
): CharacterRecord | null {
  const snapshot = session.snapshot;
  const name =
    readName(session.title) || readName(snapshot.characterName) || readName(snapshot.bio?.name);
  if (!name) {
    return null;
  }
  return {
    id: session.id.startsWith('char-') ? session.id : `char-rp-${session.id}`,
    name,
    version: 1,
    updatedAt: session.updatedAt || Date.now(),
    descriptor: snapshot.bio?.look?.trim() || undefined,
    bio: snapshot.bio,
    reference: {
      originalUrl: snapshot.referenceOriginalUrl,
      originalFilename: snapshot.referenceOriginalFilename,
      isolatedUrl: snapshot.referenceImageUrl,
      isolatedFilename: snapshot.referenceImageFilename,
      isolated: snapshot.referenceIsolated,
      isolateSubject: snapshot.isolateSubject,
    },
    ipAdapter: snapshot.referenceImageFilename
      ? {
          imageFilename: snapshot.referenceImageFilename,
          imageUrl: snapshot.referenceImageUrl,
        }
      : undefined,
    personaId: snapshot.personaId,
    customPersona: snapshot.customPersona,
    characterName: snapshot.characterName,
    setting: snapshot.setting,
    tone: snapshot.tone,
    content: snapshot.content,
    playAs: snapshot.playAs,
  };
}

export function mergeMigratedCharacters(input: {
  existing: CharacterRecord[];
  bundles?: CharacterIdentityBundle[];
  roleplaySessions?: RoleplayLibrarySession[];
}): CharacterRecord[] {
  const merged = new Map<string, CharacterRecord>();
  for (const character of input.existing) {
    if (character.id) {
      merged.set(character.id, character);
    }
  }

  const nameOwner = (name: string) =>
    [...merged.values()].find(entry => slugCharacterName(entry.name) === slugCharacterName(name));

  for (const bundle of input.bundles ?? []) {
    const key = slugCharacterName(bundle.name);
    if (!key || nameOwner(bundle.name)) {
      continue;
    }
    const record = characterFromBundle(bundle);
    merged.set(record.id, record);
  }

  for (const session of input.roleplaySessions ?? []) {
    const converted = characterFromRoleplaySession(session);
    if (!converted || merged.has(converted.id)) {
      continue;
    }
    const clash = nameOwner(converted.name);
    if (clash && !clash.id.startsWith('char-rp-')) {
      continue;
    }
    merged.set(converted.id, converted);
  }

  return [...merged.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CHARACTERS);
}

function emptyStore(): CharacterStore {
  return { version: 1, migratedFromBundles: false, characters: [], removedIds: [] };
}

export function roleplayLibraryIdFromCharacter(id: string): string | undefined {
  const key = id.trim();
  if (!key.startsWith('char-rp-')) {
    return undefined;
  }
  const sessionId = key.slice('char-rp-'.length).trim();
  return sessionId || undefined;
}

export function applyRemovedCharacterIds(
  characters: CharacterRecord[],
  removedIds: string[] | undefined
): CharacterRecord[] {
  const removed = new Set((removedIds ?? []).map(entry => entry.trim()).filter(Boolean));
  if (removed.size === 0) {
    return characters;
  }
  return characters.filter(entry => !removed.has(entry.id));
}

function readStore(): CharacterStore {
  const raw = readBrowserValue<CharacterStore>(CHARACTERS_KEY);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.characters)) {
    return emptyStore();
  }
  return {
    version: 1,
    migratedFromBundles: raw.migratedFromBundles === true,
    characters: raw.characters
      .filter(entry => entry && readName(entry.name) && entry.id)
      .map(normalizeCharacterRecord),
    removedIds: uniqueIds(
      Array.isArray(raw.removedIds)
        ? raw.removedIds.filter((id): id is string => typeof id === 'string')
        : []
    ),
  };
}

function writeStore(store: CharacterStore): void {
  writeBrowserValue(CHARACTERS_KEY, {
    version: 1,
    migratedFromBundles: store.migratedFromBundles,
    characters: store.characters.slice(0, MAX_CHARACTERS),
    removedIds: uniqueIds(store.removedIds) ?? [],
  });
  notifyCharactersUpdated();
}

export function loadCharacters(): CharacterRecord[] {
  const store = readStore();
  if (store.migratedFromBundles || store.characters.length > 0) {
    return store.characters;
  }
  return store.characters;
}

export function migrateCharactersFromLegacy(input: {
  bundles?: CharacterIdentityBundle[];
  roleplaySessions?: RoleplayLibrarySession[];
}): CharacterRecord[] {
  const store = readStore();
  const firstImport = !store.migratedFromBundles;
  const characters = applyRemovedCharacterIds(
    mergeMigratedCharacters({
      existing: store.characters,
      bundles: firstImport ? input.bundles : [],
      roleplaySessions: input.roleplaySessions,
    }),
    store.removedIds
  );
  const existingIds = new Set(store.characters.map(entry => entry.id));
  const importedNew = characters.some(entry => !existingIds.has(entry.id));
  if (!firstImport && !importedNew) {
    return store.characters;
  }
  writeStore({
    version: 1,
    migratedFromBundles: true,
    characters,
    removedIds: store.removedIds,
  });
  return characters;
}

/** Create or refresh a Cast record from a Roleplay library session without clobbering looks. */
export function upsertCharacterFromRoleplaySession(
  session: RoleplayLibrarySession
): CharacterRecord | undefined {
  const converted = characterFromRoleplaySession(session);
  if (!converted) {
    return undefined;
  }
  const existing = loadCharacters();
  const prev = existing.find(entry => entry.id === converted.id);
  if (prev) {
    upsertCharacter({
      ...converted,
      id: prev.id,
      looks: looksOf(prev),
      loraLibraryIds: prev.loraLibraryIds,
      loraTriggerPhrases: prev.loraTriggerPhrases,
      filmCut: prev.filmCut,
    });
    return getCharacter(prev.id);
  }
  upsertCharacter(converted);
  return getCharacter(converted.id);
}

export function saveCharacters(characters: CharacterRecord[]): CharacterRecord[] {
  const store = readStore();
  const next = characters
    .filter(entry => readName(entry.name) && entry.id)
    .map(normalizeCharacterRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CHARACTERS);
  const kept = new Set(next.map(entry => entry.id));
  writeStore({
    ...store,
    characters: next,
    removedIds: (store.removedIds ?? []).filter(id => !kept.has(id)),
  });
  return next;
}

function mergeCharacterUpdate(prev: CharacterRecord, incoming: CharacterRecord): CharacterRecord {
  if (Array.isArray(incoming.looks)) {
    return normalizeCharacterRecord({
      ...prev,
      ...incoming,
      looks: incoming.looks,
      loraLibraryIds: incoming.loraLibraryIds ?? prev.loraLibraryIds,
      loraTriggerPhrases: incoming.loraTriggerPhrases ?? prev.loraTriggerPhrases,
      filmCut: incoming.filmCut ?? prev.filmCut,
      lookPacks: incoming.lookPacks ?? prev.lookPacks,
    });
  }

  const looks = looksOf(prev);
  const current = looks.find(look => look.id === prev.activeLookId) ?? looks[0]!;
  const nextLook = {
    ...lookFromAppearance(incoming, current.name, current.id, current.createdAt),
    keeperEntryIds: current.keeperEntryIds,
  };
  const nextLooks = looks.some(look => look.id === nextLook.id)
    ? looks.map(look => (look.id === nextLook.id ? nextLook : look))
    : [nextLook, ...looks].slice(0, MAX_LOOKS);
  return normalizeCharacterRecord({
    ...prev,
    ...incoming,
    looks: nextLooks,
    activeLookId: nextLook.id,
    loraLibraryIds: incoming.loraLibraryIds ?? prev.loraLibraryIds,
    loraTriggerPhrases: incoming.loraTriggerPhrases ?? prev.loraTriggerPhrases,
    filmCut: incoming.filmCut ?? prev.filmCut,
    lookPacks: incoming.lookPacks ?? prev.lookPacks,
  });
}

export function upsertCharacter(record: CharacterRecord): CharacterRecord[] {
  const name = readName(record.name);
  if (!name) {
    return loadCharacters();
  }
  const id = record.id?.trim() || newCharacterId();
  const existing = loadCharacters();
  const prev = existing.find(entry => entry.id === id);
  const drafted: CharacterRecord = {
    ...record,
    name,
    version: 1,
    id,
    updatedAt: Date.now(),
  };
  const nextRecord = prev ? mergeCharacterUpdate(prev, drafted) : normalizeCharacterRecord(drafted);
  const incomingIsRoleplay = nextRecord.id.startsWith('char-rp-');
  const without = existing.filter(entry => {
    if (entry.id === nextRecord.id) {
      return false;
    }
    if (slugCharacterName(entry.name) !== slugCharacterName(name)) {
      return true;
    }
    // Distinct Roleplay sessions can share a display name without eating each other.
    if (incomingIsRoleplay && entry.id.startsWith('char-rp-')) {
      return true;
    }
    return false;
  });
  return saveCharacters([nextRecord, ...without]);
}

export function addLookFromShared(
  characterId: string,
  shared: SharedToolSettings,
  lookName: string
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const look = lookFromAppearance(
    characterFromShared(shared, { name: character.name, hints: shared.activeCharacterDescriptor }),
    lookName || `Look ${looksOf(character).length + 1}`
  );
  const looks = [look, ...looksOf(character).filter(entry => entry.id !== look.id)].slice(
    0,
    MAX_LOOKS
  );
  upsertCharacter(
    applyLookFields(
      {
        ...character,
        looks,
        updatedAt: Date.now(),
      },
      look
    )
  );
  return getCharacter(characterId);
}

export function activateLook(characterId: string, lookId: string): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const look = looksOf(character).find(entry => entry.id === lookId);
  if (!look) {
    return character;
  }
  upsertCharacter(
    applyLookFields(
      {
        ...character,
        looks: looksOf(character),
        updatedAt: Date.now(),
      },
      look
    )
  );
  return getCharacter(characterId);
}

export function removeLook(characterId: string, lookId: string): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const remaining = looksOf(character).filter(look => look.id !== lookId);
  if (remaining.length === 0) {
    return character;
  }
  const nextActive = remaining.find(look => look.id === character.activeLookId) ?? remaining[0]!;
  upsertCharacter(
    applyLookFields(
      {
        ...character,
        looks: remaining,
        updatedAt: Date.now(),
      },
      nextActive
    )
  );
  return getCharacter(characterId);
}

export function setLookKeepers(
  characterId: string,
  lookId: string,
  keeperEntryIds: string[]
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const looks = looksOf(character);
  const target = looks.find(look => look.id === lookId) ?? looks[0];
  if (!target) {
    return character;
  }
  const nextLook = {
    ...target,
    keeperEntryIds: uniqueIds(keeperEntryIds),
  };
  upsertCharacter({
    ...character,
    looks: looks.map(look => (look.id === nextLook.id ? nextLook : look)),
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function toggleLookKeeper(
  characterId: string,
  lookId: string,
  entryId: string,
  options?: { fallbackIds?: string[] }
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  const id = entryId.trim();
  if (!character || !id) {
    return character;
  }
  const looks = looksOf(character);
  const target = looks.find(look => look.id === lookId) ?? looks[0];
  if (!target) {
    return character;
  }
  const current = target.keeperEntryIds
    ? [...target.keeperEntryIds]
    : [...(options?.fallbackIds ?? [])];
  const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  return setLookKeepers(characterId, target.id, next);
}

export function pinLoraOnCharacter(
  characterId: string,
  loraLibraryId: string
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  const id = loraLibraryId.trim();
  if (!character || !id) {
    return character;
  }
  upsertCharacter({
    ...character,
    looks: looksOf(character),
    loraLibraryIds: uniqueIds([...(character.loraLibraryIds ?? []), id]),
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function saveCharacterFilmCut(
  characterId: string,
  filmCut: CharacterFilmCut
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  upsertCharacter({
    ...character,
    looks: looksOf(character),
    filmCut: {
      ...filmCut,
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function setCharacterTrigger(
  characterId: string,
  trigger: string
): CharacterRecord | undefined {
  const character = getCharacter(characterId);
  if (!character) {
    return undefined;
  }
  const phrase = trigger.trim();
  upsertCharacter({
    ...character,
    looks: looksOf(character),
    loraTriggerPhrases: phrase ? [phrase] : undefined,
    updatedAt: Date.now(),
  });
  return getCharacter(characterId);
}

export function removeCharacter(id: string): CharacterRecord[] {
  const key = id.trim();
  if (!key) {
    return loadCharacters();
  }
  const store = readStore();
  writeStore({
    ...store,
    characters: store.characters.filter(entry => entry.id !== key),
    removedIds: uniqueIds([...(store.removedIds ?? []), key]) ?? [key],
  });
  return loadCharacters();
}

/** Drop a Cast record, remember the id so Roleplay migrate does not bring it back, and clear the session lock. */
export function forgetCharacterRecord(id: string): {
  roleplaySessionId?: string;
  wasActive: boolean;
} {
  const key = id.trim();
  const wasActive = loadSettingsCache().shared.activeCharacterId?.trim() === key;
  removeCharacter(key);
  if (wasActive) {
    const shared = loadSettingsCache().shared;
    saveSharedSettings({
      ...shared,
      activeCharacterId: undefined,
      activeLookId: undefined,
    });
  }
  return {
    roleplaySessionId: roleplayLibraryIdFromCharacter(key),
    wasActive,
  };
}

export function getCharacter(id: string | undefined): CharacterRecord | undefined {
  const key = id?.trim();
  if (!key) {
    return undefined;
  }
  return loadCharacters().find(entry => entry.id === key);
}

export function loraTriggerFromCharacter(
  character: CharacterRecord | undefined
): string | undefined {
  const trigger = character?.loraTriggerPhrases?.map(entry => entry.trim()).find(Boolean);
  return trigger || undefined;
}

/** @deprecated Use Character OS records; kept so bundle export stays lossless. */
export function sharedPatchFromLegacyBundle(
  bundle: CharacterIdentityBundle
): Partial<SharedToolSettings> {
  return applyCharacterIdentityBundle(bundle);
}

export function buildBundleFromShared(
  name: string,
  shared: SharedToolSettings,
  hints?: string
): CharacterIdentityBundle {
  return buildCharacterIdentityBundle({ name, shared, hints });
}
