'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/ViewState';
import { ToolBadge, ToolLayout, ToolSection } from '@/components/ui/ToolPageShell';
import { whenBrowserStorageReady } from '@/lib/browser-storage';
import {
  applyCharacterRecord,
  characterHomeHref,
  getCharactersSnapshot,
  getServerCharactersSnapshot,
  looksOf,
  loraTriggerFromCharacter,
  forgetCharacterRecord,
  migrateCharactersFromLegacy,
  subscribeCharacters,
} from '@/lib/character-os';
import {
  listSavedIdentityBundles,
  loadSettingsCache,
  saveSharedSettings,
} from '@/lib/settings-cache';
import {
  deleteRoleplayLibrarySession,
  roleplaySessionsForCharacterSync,
} from '@/lib/roleplay-library';

export default function CharacterCastRoster() {
  const router = useRouter();
  const characters = useSyncExternalStore(
    subscribeCharacters,
    getCharactersSnapshot,
    getServerCharactersSnapshot
  );

  useEffect(() => {
    let cancelled = false;
    void whenBrowserStorageReady().then(() => {
      if (cancelled) {
        return;
      }
      migrateCharactersFromLegacy({
        bundles: listSavedIdentityBundles(),
        roleplaySessions: roleplaySessionsForCharacterSync(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const forgetCharacter = (id: string) => {
    const character = characters.find(entry => entry.id === id);
    const name = character?.name?.trim() || 'this character';
    if (
      !window.confirm(
        `Remove ${name} from the cast? Looks on this record go with it. Gallery stills stay in the gallery.`
      )
    ) {
      return;
    }
    const { roleplaySessionId } = forgetCharacterRecord(id);
    if (roleplaySessionId) {
      deleteRoleplayLibrarySession(roleplaySessionId);
    }
  };

  const applyAndOpen = (id: string) => {
    const character = characters.find(entry => entry.id === id);
    if (!character) {
      return;
    }
    saveSharedSettings({
      ...loadSettingsCache().shared,
      ...applyCharacterRecord(character),
    });
    router.push(characterHomeHref(id));
  };

  const applyAndTryOn = (id: string) => {
    const character = characters.find(entry => entry.id === id);
    if (!character) {
      return;
    }
    saveSharedSettings({
      ...loadSettingsCache().shared,
      ...applyCharacterRecord(character),
    });
    router.push(`/fitting?character=${encodeURIComponent(id)}`);
  };

  const applyAndPlanDay = (id: string) => {
    const character = characters.find(entry => entry.id === id);
    if (!character) {
      return;
    }
    saveSharedSettings({
      ...loadSettingsCache().shared,
      ...applyCharacterRecord(character),
    });
    router.push(`/day?character=${encodeURIComponent(id)}`);
  };

  return (
    <ToolLayout
      accent="sky"
      width="wide"
      badge={<ToolBadge accent="sky">Cast</ToolBadge>}
      title="Characters"
      description="The character is the project. Open a home for looks, stills, clips, and LoRA — or run a Play campaign."
    >
      {characters.length > 0 ? (
        <ToolSection title="Play loop" description="Guided Moodboard → Fitting → Day → Roleplay.">
          <ButtonLink href="/play" size="sm" variant="primary">
            Start Play campaign
          </ButtonLink>
        </ToolSection>
      ) : null}
      {characters.length === 0 ? (
        <EmptyState
          icon="catalog"
          title="No characters yet"
          description="Create a character on Play to start the film loop. Roleplay Save to Cast and Generate looks remain optional paths; identity bundles migrate in automatically."
          action={{ label: 'Create on Play', href: '/play' }}
        />
      ) : (
        <ToolSection title="Roster" description={`${characters.length} saved`}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {characters.map(character => {
              const looks = looksOf(character);
              const trigger = loraTriggerFromCharacter(character);
              return (
                <li key={character.id} className="ui-card space-y-3 p-[var(--card-padding)]">
                  <div className="space-y-1">
                    <p className="type-heading">{character.name}</p>
                    <p className="type-caption text-[var(--text-muted)]">
                      {looks.length} look{looks.length === 1 ? '' : 's'}
                      {trigger ? ` · ${trigger}` : ''}
                      {character.loraLibraryIds?.length
                        ? ` · ${character.loraLibraryIds.length} LoRA`
                        : ''}
                    </p>
                    {character.descriptor ? (
                      <p className="type-caption line-clamp-2">{character.descriptor}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => applyAndOpen(character.id)}>
                      Open home
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => applyAndTryOn(character.id)}
                    >
                      Try on
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => applyAndPlanDay(character.id)}
                    >
                      Plan a day
                    </Button>
                    <ButtonLink href="/character" size="sm" variant="secondary">
                      Generate
                    </ButtonLink>
                    <Link
                      href={characterHomeHref(character.id)}
                      className="type-caption self-center text-[var(--accent-text)] underline-offset-2 hover:underline"
                    >
                      Details
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => forgetCharacter(character.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </ToolSection>
      )}
    </ToolLayout>
  );
}
