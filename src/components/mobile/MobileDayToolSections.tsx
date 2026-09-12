'use client';

import Link from 'next/link';
import CharacterOsPicker from '@/components/CharacterOsPicker';
import FilmWatchPlayer from '@/components/FilmWatchPlayer';
import { Button, ButtonLink, PrimaryButton } from '@/components/ui/Button';
import { ChipButton, FieldError, FieldLabel, SelectInput, TextArea } from '@/components/ui/Field';
import type { useDayPlannerToolOrchestration } from '@/hooks/useDayPlannerToolOrchestration';
import { ROLEPLAY_SETTING_PRESETS } from '@/lib/roleplay';
import {
  resolveFilmFailurePlaybook,
  resolveQueueFailureGuideLabel,
} from '@/lib/queue-failure-playbook';
import {
  countWardrobeOptionsForFilter,
  normalizeWardrobeCategoryFilter,
  wardrobeCategoryFilterOptions,
} from '@/lib/wardrobe-catalog-ui';

type ViewModel = ReturnType<typeof useDayPlannerToolOrchestration>;

export default function MobileDayToolSections(vm: ViewModel) {
  const {
    shared,
    toolSettings,
    updateShared,
    updateToolSettings,
    error,
    setError,
    filmGuideHref,
    busy,
    activeSlotId,
    setActiveSlotId,
    assemblingFilm,
    filmStatus,
    filmNeedsCast,
    slots,
    stills,
    watchPlaylist,
    activeSlot,
    character,
    hasPlate,
    wardrobeOptions,
    wardrobeReady,
    wardrobeCategoryFilter,
    filteredWardrobeOptions,
    wardrobeKitCount,
    updateSlot,
    queueSlot,
    queueAll,
    animateSlot,
    animateAllClips,
    cutDayFilm,
    saveFilmToCast,
    completedShotCount,
    fittingWardrobe,
  } = vm;

  const playbookHref =
    filmGuideHref ?? (error ? resolveFilmFailurePlaybook(error).href : undefined);

  return (
    <div className="space-y-4" data-testid="mobile-day">
      <div className="space-y-1">
        <h1 className="type-display text-2xl tracking-tight">Day</h1>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          Four slots → stills → clips → Cut film on the phone.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
        <CharacterOsPicker
          shared={shared}
          hints={character?.hints}
          onApply={patch => {
            try {
              updateShared(patch);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not apply that character.');
            }
          }}
        />
        <p className="type-caption mt-2 text-[var(--text-muted)]">
          {hasPlate
            ? 'Cast plate detected — identity lock when available.'
            : 'No Cast plate — stills queue as text scenes.'}
        </p>
      </div>

      <div className="space-y-2" data-testid="day-slots">
        <div className="flex flex-wrap gap-2">
          {slots.map(slot => {
            const still = stills.find(entry => entry.slotId === slot.id);
            const stillStatus =
              still?.status === 'completed'
                ? ' · still'
                : still?.status === 'queued' || still?.status === 'running'
                  ? ' · queued'
                  : still?.status === 'error'
                    ? ' · failed'
                    : '';
            const clipStatus =
              still?.clipStatus === 'completed'
                ? ' · clip'
                : still?.clipStatus === 'queued' || still?.clipStatus === 'running'
                  ? ' · animating'
                  : '';
            return (
              <ChipButton
                key={slot.id}
                active={activeSlotId === slot.id}
                disabled={busy}
                onClick={() => setActiveSlotId(slot.id)}
              >
                {slot.label}
                {stillStatus}
                {clipStatus}
              </ChipButton>
            );
          })}
        </div>

        <label className="block space-y-1.5 text-sm">
          <FieldLabel>Clothing type</FieldLabel>
          <SelectInput
            value={wardrobeCategoryFilter}
            disabled={!wardrobeReady || busy}
            onChange={event =>
              updateToolSettings({
                wardrobeCategoryFilter: normalizeWardrobeCategoryFilter(event.target.value),
              })
            }
          >
            {wardrobeCategoryFilterOptions().map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.value !== 'all' && wardrobeReady
                  ? ` (${countWardrobeOptionsForFilter(wardrobeOptions, option.value)})`
                  : option.value === 'all' && wardrobeReady
                    ? ` (${countWardrobeOptionsForFilter(wardrobeOptions, 'all')})`
                    : ''}
              </option>
            ))}
          </SelectInput>
          {wardrobeReady && wardrobeCategoryFilter !== 'all' ? (
            <p className="type-caption text-[var(--text-muted)]">
              {wardrobeKitCount} kit{wardrobeKitCount === 1 ? '' : 's'} for{' '}
              {activeSlot.label.toLowerCase()}.
            </p>
          ) : null}
        </label>

        <label className="block space-y-1.5 text-sm">
          <FieldLabel>Outfit kit</FieldLabel>
          <SelectInput
            value={activeSlot.wardrobeId ?? ''}
            disabled={!wardrobeReady || busy}
            onChange={event => {
              const value = event.target.value.trim();
              updateSlot(activeSlot.id, { wardrobeId: value || undefined });
            }}
          >
            {filteredWardrobeOptions.map(option => (
              <option key={option.value || 'default'} value={option.value}>
                {option.group ? `${option.label} · ${option.group}` : option.label}
              </option>
            ))}
          </SelectInput>
        </label>

        <label className="block space-y-1.5 text-sm">
          <FieldLabel>Setting</FieldLabel>
          <SelectInput
            value=""
            disabled={busy}
            onChange={event => {
              const preset = ROLEPLAY_SETTING_PRESETS.find(
                entry => entry.id === event.target.value
              );
              if (preset) {
                updateSlot(activeSlot.id, { location: preset.setting });
              }
            }}
          >
            <option value="">Insert preset…</option>
            {ROLEPLAY_SETTING_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </SelectInput>
          <TextArea
            rows={2}
            data-testid="day-slot-location"
            value={activeSlot.location ?? ''}
            placeholder="e.g. sunlit café, rainy commute"
            onChange={event => updateSlot(activeSlot.id, { location: event.target.value })}
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <FieldLabel>Beat</FieldLabel>
          <TextArea
            rows={3}
            value={activeSlot.sceneHints ?? ''}
            placeholder="What happens in this part of the day?"
            onChange={event => updateSlot(activeSlot.id, { sceneHints: event.target.value })}
          />
        </label>

        <div className="grid gap-2">
          <PrimaryButton
            disabled={busy}
            loading={busy}
            data-testid="day-slot-queue"
            onClick={() => void queueSlot(activeSlot)}
            className="w-full justify-center"
          >
            Queue {activeSlot.label.toLowerCase()}
          </PrimaryButton>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void queueAll()}
            className="w-full justify-center"
          >
            Queue all slots
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void animateSlot(activeSlot)}
            className="w-full justify-center"
          >
            Animate slot
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void animateAllClips()}
            className="w-full justify-center"
          >
            Animate all
          </Button>
        </div>
      </div>

      <label className="block space-y-1.5 text-sm">
        <FieldLabel>Day notes</FieldLabel>
        <TextArea
          rows={2}
          value={toolSettings.notes ?? ''}
          placeholder="Optional notes for every slot"
          onChange={event => updateToolSettings({ notes: event.target.value })}
        />
      </label>

      <div className="space-y-2" data-testid="day-reel">
        <p className="type-caption text-[var(--text-muted)]">Day reel</p>
        <FilmWatchPlayer
          shots={watchPlaylist}
          emptyLabel="Queue slot stills, then animate clips for the reel."
        />
        <PrimaryButton
          disabled={busy || assemblingFilm || completedShotCount === 0}
          loading={assemblingFilm}
          loadingLabel="Cutting film"
          onClick={() => void cutDayFilm()}
          className="w-full justify-center"
          data-testid="mobile-day-cut"
        >
          Cut film
        </PrimaryButton>
        {filmNeedsCast ? (
          <Button
            variant="secondary"
            disabled={busy || assemblingFilm}
            onClick={saveFilmToCast}
            className="w-full justify-center"
            data-testid="day-save-film-cast"
          >
            Save film to Cast
          </Button>
        ) : null}
        {character && filmStatus && !assemblingFilm ? (
          <Link
            href={`/characters/${encodeURIComponent(character.id)}?media=films`}
            className="ui-btn-primary w-full justify-center text-center text-sm"
            data-testid="day-open-cast-film"
            onClick={() => {
              void import('@/lib/onboarding-hooks').then(({ markOnboardingWatchFirstFilm }) => {
                markOnboardingWatchFirstFilm();
              });
            }}
          >
            Watch / Save on Cast
          </Link>
        ) : null}
        {character && filmStatus && !assemblingFilm ? (
          <Link
            href={`/play?character=${encodeURIComponent(character.id)}`}
            className="ui-btn-ghost w-full justify-center text-center text-sm"
            data-testid="day-campaign-complete"
          >
            Back to Play
          </Link>
        ) : null}
        {filmStatus ? <p className="type-caption text-[var(--text-muted)]">{filmStatus}</p> : null}
      </div>

      <div className="grid gap-2">
        {character ? (
          <>
            <Link
              href={`/m/fitting?character=${encodeURIComponent(character.id)}${
                fittingWardrobe ? `&wardrobe=${encodeURIComponent(fittingWardrobe)}` : ''
              }`}
              className="ui-btn-ghost w-full justify-center text-center text-sm"
            >
              Try on in Fitting
            </Link>
            <Link
              href={`/m/moodboard?character=${encodeURIComponent(character.id)}`}
              className="ui-btn-ghost w-full justify-center text-center text-sm"
            >
              Set look (Moodboard)
            </Link>
            <Link href="/m/play" className="ui-btn-ghost w-full justify-center text-center text-sm">
              Continue in Play
            </Link>
          </>
        ) : null}
      </div>

      <FieldError>{error}</FieldError>
      {error && playbookHref ? (
        <ButtonLink
          href={playbookHref}
          size="sm"
          variant="ghost"
          className="mt-2"
          data-testid="film-failure-playbook-link"
        >
          {resolveQueueFailureGuideLabel(playbookHref)}
        </ButtonLink>
      ) : null}
    </div>
  );
}
