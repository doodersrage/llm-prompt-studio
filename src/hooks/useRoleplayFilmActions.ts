'use client';

import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import {
  assembleAndStampFilm,
  downloadFilmBlob,
  stampAssembledFilm,
} from '@/lib/character-film-assemble';
import { roleplayWatchPlaylist } from '@/lib/character-film';
import {
  applyCharacterRecord,
  characterFromRoleplaySession,
  getCharacter,
  loadCharacters,
  upsertCharacterFromRoleplaySession,
} from '@/lib/character-os';
import {
  markOnboardingFirstFilmCut,
  markOnboardingFirstPlayCampaign,
} from '@/lib/onboarding-hooks';
import { completePlayCampaign } from '@/lib/play-campaign';
import {
  persistRoleplayLibraryFromCache,
  snapshotRoleplaySession,
  upsertRoleplayLibrarySession,
} from '@/lib/roleplay-library';
import {
  loadSettingsCache,
  saveSharedSettings,
  type RoleplayToolCache,
} from '@/lib/settings-cache';
import { resolveFilmFailurePlaybook } from '@/lib/queue-failure-playbook';
import type { RoleplayStoryBeat } from '@/lib/roleplay';

export function useRoleplayFilmActions(input: {
  toolSettings: RoleplayToolCache;
  storyRef: MutableRefObject<RoleplayStoryBeat[]>;
  bioName?: string;
}) {
  const [assemblingFilm, setAssemblingFilm] = useState(false);
  const [filmStatus, setFilmStatus] = useState<string | null>(null);
  const [filmNeedsCast, setFilmNeedsCast] = useState(false);
  const [filmCharacterId, setFilmCharacterId] = useState<string | null>(null);
  const assembledFilmRef = useRef<{ filename: string; data: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filmGuideHref, setFilmGuideHref] = useState<string | null>(null);

  const cutRoleplayFilm = useCallback(async () => {
    const shots = roleplayWatchPlaylist(input.storyRef.current);
    if (shots.length === 0) {
      setFilmGuideHref(null);
      setError('Need a completed still or clip before cutting a film.');
      return;
    }
    const name = input.toolSettings.characterName?.trim() || input.bioName?.trim() || 'roleplay';
    const session = snapshotRoleplaySession(input.toolSettings);
    const fromSession = session ? characterFromRoleplaySession(session) : null;
    let character =
      (fromSession ? getCharacter(fromSession.id) : undefined) ||
      loadCharacters().find(entry => {
        const labels = [entry.name, entry.characterName].map(value => value?.trim().toLowerCase());
        return labels.includes(name.toLowerCase());
      });
    if (!character && session) {
      character = upsertCharacterFromRoleplaySession(session);
      upsertRoleplayLibrarySession(session);
    }
    setAssemblingFilm(true);
    setError(null);
    setFilmGuideHref(null);
    setFilmNeedsCast(false);
    setFilmStatus('Checking shots…');
    try {
      const result = await assembleAndStampFilm({
        shots,
        characterId: character?.id ?? '',
        characterName: name,
        lookId: character?.activeLookId,
        onProgress: progress => setFilmStatus(progress.label),
      });
      downloadFilmBlob(result.blob, result.filename);
      assembledFilmRef.current = {
        filename: result.filename,
        data: new Uint8Array(await result.blob.arrayBuffer()),
      };
      if (character) {
        setFilmCharacterId(character.id);
      }
      if (character && result.persisted) {
        setFilmNeedsCast(false);
        setFilmStatus(
          `Saved ${result.filename} to ${character.name} (${result.encodePath} encode) and started the download.`
        );
      } else {
        setFilmNeedsCast(true);
        setFilmStatus(
          character
            ? `Downloaded ${result.filename} (${result.encodePath} encode). Save to Cast to stamp a studio copy.`
            : `Downloaded ${result.filename} (${result.encodePath} encode) unstamped. Save to Cast to attach this film to a character.`
        );
      }
      markOnboardingFirstPlayCampaign();
      markOnboardingFirstFilmCut();
      void import('@/lib/local-observability').then(
        ({ noteFilmCutSourceMetric, noteSaveToCastMetric }) => {
          noteFilmCutSourceMetric('roleplay');
          if (character && result.persisted) {
            noteSaveToCastMetric();
          }
        }
      );
      if (character) {
        completePlayCampaign({ characterId: character.id, stepId: 'roleplay' });
      }
    } catch (err) {
      const playbook = resolveFilmFailurePlaybook(
        err instanceof Error ? err.message : 'Could not assemble the film.'
      );
      setError(playbook.message);
      setFilmGuideHref(playbook.href ?? null);
      setFilmStatus(null);
    } finally {
      setAssemblingFilm(false);
    }
  }, [input.bioName, input.storyRef, input.toolSettings]);

  const saveFilmToCast = useCallback(() => {
    const persisted = persistRoleplayLibraryFromCache(input.toolSettings);
    if (!persisted) {
      setError('Name the character and add a beat before saving to Cast.');
      return;
    }
    const created =
      getCharacter(
        persisted.session.id.startsWith('char-')
          ? persisted.session.id
          : `char-rp-${persisted.session.id}`
      ) ?? upsertCharacterFromRoleplaySession(persisted.session);
    if (!created) {
      setError('Name the character before saving to Cast.');
      return;
    }
    saveSharedSettings({
      ...loadSettingsCache().shared,
      ...applyCharacterRecord(created),
    });
    setFilmCharacterId(created.id);
    void import('@/lib/local-observability').then(({ noteSaveToCastMetric }) => {
      noteSaveToCastMetric();
    });
    const film = assembledFilmRef.current;
    if (!film) {
      setFilmNeedsCast(false);
      setFilmStatus(`Saved ${created.name} to Cast.`);
      return;
    }
    void (async () => {
      const stamped = await stampAssembledFilm({
        blob: new Blob([film.data.slice()]),
        filename: film.filename,
        characterId: created.id,
        characterName: created.name,
        lookId: created.activeLookId,
      });
      setFilmNeedsCast(false);
      setFilmStatus(
        stamped.persisted
          ? `Saved ${created.name} to Cast and stamped ${film.filename}.`
          : `Saved ${created.name} to Cast. Studio storage could not keep the film.`
      );
    })();
  }, [input.toolSettings]);

  return {
    assemblingFilm,
    filmStatus,
    filmNeedsCast,
    filmCharacterId,
    cutRoleplayFilm,
    saveFilmToCast,
    filmError: error,
    filmGuideHref,
    assembledFilmRef,
    clearFilmError: () => {
      setError(null);
      setFilmGuideHref(null);
    },
  };
}
