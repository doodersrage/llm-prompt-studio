import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APP_FEATURES,
  ALL_FEATURE_IDS,
  featureForPath,
  featureLabel,
  type AppFeatureId,
} from './features';

describe('auth/features', () => {
  describe('APP_FEATURES', () => {
    it('is non-empty', () => {
      assert.ok(APP_FEATURES.length > 0);
    });

    it('has unique ids', () => {
      const ids = APP_FEATURES.map(feature => feature.id);
      assert.equal(new Set(ids).size, ids.length);
    });

    it('has a non-empty label and description for every feature', () => {
      for (const feature of APP_FEATURES) {
        assert.ok(feature.label.length > 0, `${feature.id} should have a label`);
        assert.ok(feature.description.length > 0, `${feature.id} should have a description`);
      }
    });
  });

  describe('ALL_FEATURE_IDS', () => {
    it('matches the APP_FEATURES ids exactly, in order', () => {
      assert.deepEqual(
        ALL_FEATURE_IDS,
        APP_FEATURES.map(feature => feature.id)
      );
    });

    it('has the same length as APP_FEATURES', () => {
      assert.equal(ALL_FEATURE_IDS.length, APP_FEATURES.length);
    });
  });

  describe('featureForPath', () => {
    it('maps the root path to "generate"', () => {
      assert.equal(featureForPath('/'), 'generate');
    });

    it('maps an exact prefix match', () => {
      assert.equal(featureForPath('/dashboard'), 'dashboard');
      assert.equal(featureForPath('/queue'), 'queue');
    });

    it('maps a nested path under a prefix', () => {
      assert.equal(featureForPath('/characters/char-rin'), 'character');
      assert.equal(featureForPath('/api/comfyui/status'), 'comfyui-api');
    });

    it('strips a query string before matching', () => {
      assert.equal(featureForPath('/gallery?page=2'), 'gallery');
      assert.equal(featureForPath('/?ref=home'), 'generate');
    });

    it('resolves the more specific "/m/queue" prefix over the broader "/m" prefix', () => {
      assert.equal(featureForPath('/m/queue'), 'queue');
      assert.equal(featureForPath('/m/gallery'), 'gallery');
      assert.equal(featureForPath('/m'), 'gallery');
      assert.equal(featureForPath('/m/capture'), 'gallery');
    });

    it('maps API routes independently of page routes', () => {
      assert.equal(featureForPath('/api/roleplay'), 'llm-api');
      assert.equal(featureForPath('/api/lora-train'), 'settings');
      assert.equal(featureForPath('/api/plugins/server'), 'plugins');
      assert.equal(featureForPath('/api/webhooks/dispatch'), 'settings');
      assert.equal(featureForPath('/api/storage'), 'settings');
      assert.equal(featureForPath('/api/scheduled-batch/run'), 'settings');
      assert.equal(featureForPath('/api/maintenance/run'), 'settings');
      assert.equal(featureForPath('/api/collab'), 'studio');
    });

    it('returns null for a path that matches nothing', () => {
      assert.equal(featureForPath('/this-path-does-not-exist'), null);
      assert.equal(featureForPath('/api/this-route-does-not-exist'), null);
    });

    it('does not match a prefix as a substring without a path boundary', () => {
      // "/queuestats" should not match the "/queue" prefix since it isn't
      // exactly "/queue" nor does it start with "/queue/".
      assert.equal(featureForPath('/queuestats'), null);
    });
  });

  describe('featureLabel', () => {
    it('returns the configured label for a known id', () => {
      assert.equal(featureLabel('dashboard'), 'Dashboard');
      assert.equal(featureLabel('nsfw-generator'), 'Adult generator');
    });

    it('falls back to the id itself for an unknown id', () => {
      assert.equal(featureLabel('totally-unknown-id' as AppFeatureId), 'totally-unknown-id');
    });
  });
});
