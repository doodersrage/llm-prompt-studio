import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  isUsingDefaultAdminCredentials,
  getDefaultAdminCredentialsWarning,
} from './default-admin-check';

const ENV_KEYS = ['PROMPT_AUTH_ENABLED', 'PROMPT_ADMIN_PASSWORD', 'PROMPT_ADMIN_USERNAME'] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    setEnv(key, originalEnv[key]);
  }
});

describe('default-admin-check', () => {
  describe('isUsingDefaultAdminCredentials', () => {
    it('is false when auth is not enabled, regardless of the password env var', () => {
      setEnv('PROMPT_AUTH_ENABLED', undefined);
      setEnv('PROMPT_ADMIN_PASSWORD', undefined);
      assert.equal(isUsingDefaultAdminCredentials(), false);
    });

    it('is true when auth is enabled and PROMPT_ADMIN_PASSWORD is unset', () => {
      setEnv('PROMPT_AUTH_ENABLED', 'true');
      setEnv('PROMPT_ADMIN_PASSWORD', undefined);
      assert.equal(isUsingDefaultAdminCredentials(), true);
    });

    it('is true when auth is enabled and PROMPT_ADMIN_PASSWORD is a blank string', () => {
      setEnv('PROMPT_AUTH_ENABLED', 'yes');
      setEnv('PROMPT_ADMIN_PASSWORD', '   ');
      assert.equal(isUsingDefaultAdminCredentials(), true);
    });

    it('is false when auth is enabled and PROMPT_ADMIN_PASSWORD is set', () => {
      setEnv('PROMPT_AUTH_ENABLED', '1');
      setEnv('PROMPT_ADMIN_PASSWORD', 'a-strong-password');
      assert.equal(isUsingDefaultAdminCredentials(), false);
    });
  });

  describe('getDefaultAdminCredentialsWarning', () => {
    it('names the affected username and points at the docs', () => {
      setEnv('PROMPT_ADMIN_USERNAME', 'root');
      const message = getDefaultAdminCredentialsWarning();
      assert.match(message, /"root"/);
      assert.match(message, /PROMPT_ADMIN_PASSWORD/);
      assert.match(message, /docs\/configuration\.md/);
    });

    it('falls back to the "admin" username when unset', () => {
      setEnv('PROMPT_ADMIN_USERNAME', undefined);
      const message = getDefaultAdminCredentialsWarning();
      assert.match(message, /"admin"/);
    });
  });
});
