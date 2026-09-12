import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  daysFromCampaignStartToFirstFilmCut,
  firstFilmCutWithinDays,
  resolveNextPlayAction,
  resolvePlayFunnelStall,
  resolvePlayFunnelStepHref,
  type PlayMetrics,
} from './play-metrics';

describe('play-metrics', () => {
  it('computes days from campaign start to first film cut', () => {
    const day = 1000 * 60 * 60 * 24;
    const metrics: PlayMetrics = {
      version: 1,
      firstPlayCampaignAt: 1_000_000,
      firstFilmCutAt: 1_000_000 + day * 2,
    };
    assert.equal(daysFromCampaignStartToFirstFilmCut(metrics), 2);
    assert.equal(firstFilmCutWithinDays(3, metrics), true);
    assert.equal(firstFilmCutWithinDays(1, metrics), false);
  });

  it('returns null when funnel timestamps are incomplete', () => {
    assert.equal(daysFromCampaignStartToFirstFilmCut({ version: 1 }), null);
    assert.equal(
      firstFilmCutWithinDays(7, { version: 1, firstPlayCampaignAt: Date.now() }),
      null
    );
  });

  it('resolves next Play action from funnel stalls', () => {
    assert.equal(resolveNextPlayAction({}).href, '/play');
    assert.equal(
      resolveNextPlayAction({ funnel: { firstPlayCampaign: 2, firstFilmCut: 0 } }).href,
      '/day'
    );
    assert.equal(
      resolveNextPlayAction({ funnel: { keepTryOn: 3, firstFilmCut: 0 } }).label,
      'Continue in Day'
    );
    assert.equal(
      resolveNextPlayAction({ funnel: { firstFilmCut: 1, saveToCast: 0 } }).href,
      '/characters'
    );
    const resume = resolveNextPlayAction({
      campaign: { characterId: 'c1', stepIndex: 2 },
    });
    assert.equal(resume.href, '/fitting?character=c1');
    assert.match(resume.label, /Fitting/i);
  });

  it('pushes Cast watch then another Day cut after campaign complete', () => {
    const watch = resolveNextPlayAction({
      funnel: { firstFilmCut: 1, saveToCast: 1 },
      campaign: { characterId: 'c1', stepIndex: 4, completedAt: Date.now() },
      watchedFirstFilm: false,
    });
    assert.equal(watch.label, 'Watch film on Cast');
    assert.equal(watch.href, '/characters/c1?media=films');

    const again = resolveNextPlayAction({
      funnel: { firstFilmCut: 1, saveToCast: 1 },
      campaign: { characterId: 'c1', stepIndex: 4, completedAt: Date.now() },
      watchedFirstFilm: true,
    });
    assert.equal(again.label, 'Cut another Day film');
    assert.equal(again.href, '/day?character=c1');
  });

  it('detects funnel stall before first film cut', () => {
    assert.equal(resolvePlayFunnelStall({}), null);
    assert.equal(
      resolvePlayFunnelStall({
        metrics: { version: 1, firstFilmCutAt: Date.now() },
      }),
      null
    );
    const cutStall = resolvePlayFunnelStall({
      metrics: { version: 1, firstPlayCampaignAt: Date.now() - 60_000 },
      funnel: { keepTryOn: 2, firstFilmCut: 0 },
    });
    assert.equal(cutStall?.stepId, 'cut');
    assert.match(cutStall?.reason ?? '', /Cut film/i);

    const moodboardStall = resolvePlayFunnelStall({
      metrics: { version: 1, firstPlayCampaignAt: Date.now() - 60_000 },
      funnel: { firstPlayCampaign: 1, campaignMaxStep: 2 },
    });
    assert.equal(moodboardStall?.stepId, 'moodboard');
  });

  it('resolves funnel step hrefs with optional character id and look pack', () => {
    assert.equal(resolvePlayFunnelStepHref('day'), '/day');
    assert.equal(resolvePlayFunnelStepHref('day', 'c1'), '/day?character=c1');
    assert.equal(resolvePlayFunnelStepHref('cut', 'c1'), '/day?character=c1');
    assert.equal(resolvePlayFunnelStepHref('fitting', 'c1'), '/fitting?character=c1');
    assert.equal(resolvePlayFunnelStepHref('character'), '/characters');
    assert.equal(resolvePlayFunnelStepHref('moodboard', 'c1'), '/moodboard?character=c1');
    const withPack = resolvePlayFunnelStepHref('fitting', 'c1', {
      version: 1,
      source: 'moodboard',
      characterId: 'c1',
      wardrobeId: 'kit-linen',
      vibePrompt: 'soft morning light',
      savedAt: 1,
    });
    assert.match(withPack, /from=look/);
    assert.match(withPack, /wardrobe=kit-linen/);
    assert.match(withPack, /character=c1/);
  });

  it('resume CTAs carry look pack when staged', () => {
    const resume = resolveNextPlayAction({
      campaign: { characterId: 'c1', stepIndex: 2 },
      lookPack: {
        version: 1,
        source: 'moodboard',
        characterId: 'c1',
        wardrobeId: 'kit-a',
        vibePrompt: 'vibe',
        savedAt: 1,
      },
    });
    assert.match(resume.href, /from=look/);
    assert.match(resume.href, /wardrobe=kit-a/);
  });

  it('aligns stall CTA href with stall step (not bare next-action fallback)', () => {
    const fittingStall = resolvePlayFunnelStall({
      metrics: { version: 1, firstPlayCampaignAt: Date.now() - 120_000 },
      funnel: { firstPlayCampaign: 1, campaignMaxStep: 3 },
      campaign: { characterId: 'c1', stepIndex: 2 },
    });
    assert.equal(fittingStall?.stepId, 'fitting');
    assert.equal(
      resolvePlayFunnelStepHref(fittingStall!.stepId, 'c1'),
      '/fitting?character=c1'
    );

    const cutStall = resolvePlayFunnelStall({
      metrics: { version: 1, firstPlayCampaignAt: Date.now() - 60_000 },
      funnel: { keepTryOn: 1, firstFilmCut: 0, campaignMaxStep: 4 },
      campaign: { characterId: 'c1', stepIndex: 3 },
    });
    assert.equal(cutStall?.stepId, 'cut');
    assert.equal(resolvePlayFunnelStepHref(cutStall!.stepId, 'c1'), '/day?character=c1');
  });
});
