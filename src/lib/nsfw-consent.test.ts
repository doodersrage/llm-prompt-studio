import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

const readBrowserValue = mock.fn((_key: string) => null as unknown);
const writeBrowserValue = mock.fn((_key: string, _value: unknown) => {});
mock.module('./browser-storage', { namedExports: { readBrowserValue, writeBrowserValue } });

describe('nsfw-consent', async () => {
  const { NSFW_CONSENT_KEY, hasAckedNsfwConsent, ackNsfwConsent } = await import(
    './nsfw-consent'
  );

  describe('hasAckedNsfwConsent', () => {
    it('returns false when nothing is stored', () => {
      readBrowserValue.mock.mockImplementationOnce(() => null);
      assert.equal(hasAckedNsfwConsent(), false);
      assert.deepEqual(readBrowserValue.mock.calls.at(-1)?.arguments, [NSFW_CONSENT_KEY]);
    });

    it('returns false for any stored value other than exactly true', () => {
      readBrowserValue.mock.mockImplementationOnce(() => false);
      assert.equal(hasAckedNsfwConsent(), false);
      readBrowserValue.mock.mockImplementationOnce(() => 'true');
      assert.equal(hasAckedNsfwConsent(), false);
    });

    it('returns true once acknowledgment was stored', () => {
      readBrowserValue.mock.mockImplementationOnce(() => true);
      assert.equal(hasAckedNsfwConsent(), true);
    });
  });

  describe('ackNsfwConsent', () => {
    it('writes true under the consent key', () => {
      writeBrowserValue.mock.resetCalls();
      ackNsfwConsent();
      assert.deepEqual(writeBrowserValue.mock.calls.at(-1)?.arguments, [NSFW_CONSENT_KEY, true]);
    });
  });
});
