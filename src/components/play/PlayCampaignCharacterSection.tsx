'use client';

import { useState, useSyncExternalStore } from 'react';
import CharacterOsPicker from '@/components/CharacterOsPicker';
import { Button, ButtonLink } from '@/components/ui/Button';
import { FieldLabel } from '@/components/ui/Field';
import { ToolSection } from '@/components/ui/ToolPageShell';
import {
  getCharactersSnapshot,
  getServerCharactersSnapshot,
  subscribeCharacters,
} from '@/lib/character-os';
import type { usePlayCampaignWizardOrchestration } from '@/hooks/usePlayCampaignWizardOrchestration';

type PlayCampaignCharacterSectionProps = Pick<
  ReturnType<typeof usePlayCampaignWizardOrchestration>,
  | 'shared'
  | 'updateShared'
  | 'character'
  | 'activeLookPack'
  | 'persistCharacter'
  | 'createCharacter'
  | 'setStatus'
>;

export default function PlayCampaignCharacterSection({
  shared,
  updateShared,
  character,
  activeLookPack,
  persistCharacter,
  createCharacter,
  setStatus,
}: PlayCampaignCharacterSectionProps) {
  const [draftName, setDraftName] = useState('');
  const characters = useSyncExternalStore(
    subscribeCharacters,
    getCharactersSnapshot,
    getServerCharactersSnapshot
  );

  const submitCreate = (continueToMoodboard: boolean) => {
    const name = draftName.trim() || 'Untitled character';
    createCharacter({ name, continueToMoodboard });
    setDraftName('');
  };

  return (
    <ToolSection
      title="Character"
      description={
        character
          ? 'The campaign stays tied to one Cast record.'
          : 'Create a Cast character here — Roleplay is optional later, not a prerequisite.'
      }
      data-testid="play-campaign-character"
    >
      {!character ? (
        <div className="space-y-3" data-testid="play-campaign-create-character">
          <p className="type-caption text-[var(--text-muted)]">
            Name the lead for this film loop, then continue to Moodboard. You can add a face plate
            on Cast or Moodboard after.
          </p>
          <div className="space-y-2">
            <FieldLabel htmlFor="play-campaign-create-name">New character</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <input
                id="play-campaign-create-name"
                data-testid="play-campaign-create-name"
                value={draftName}
                onChange={event => setDraftName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitCreate(true);
                  }
                }}
                placeholder="e.g. Nova"
                className="ui-input min-w-[10rem] flex-1 px-[var(--input-padding-x)] py-[var(--input-padding-y)] type-body"
                aria-label="New character name"
              />
              <Button
                size="sm"
                variant="primary"
                data-testid="play-campaign-create-continue"
                onClick={() => submitCreate(true)}
              >
                Create & continue to Moodboard
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="play-campaign-create-only"
                onClick={() => submitCreate(false)}
              >
                Create only
              </Button>
            </div>
          </div>
          {characters.length > 0 ? (
            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
              <p className="type-caption text-[var(--text-muted)]">
                Or pick an existing Cast character
              </p>
              <CharacterOsPicker
                shared={shared}
                onApply={patch => {
                  try {
                    updateShared(patch);
                    if (patch.activeCharacterId) {
                      persistCharacter(patch.activeCharacterId);
                    }
                  } catch (err) {
                    setStatus(
                      err instanceof Error ? err.message : 'Could not apply that character.'
                    );
                  }
                }}
              />
            </div>
          ) : (
            <ButtonLink href="/characters" size="sm" variant="ghost">
              Browse Cast
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <CharacterOsPicker
            shared={shared}
            hints={character.hints}
            onApply={patch => {
              try {
                updateShared(patch);
                if (patch.activeCharacterId) {
                  persistCharacter(patch.activeCharacterId);
                }
              } catch (err) {
                setStatus(err instanceof Error ? err.message : 'Could not apply that character.');
              }
            }}
          />
          <p className="type-caption mt-2 text-[var(--text-muted)]">
            Active: {character.name}
            {activeLookPack ? ' · look pack staged' : ''}
          </p>
        </>
      )}
    </ToolSection>
  );
}
