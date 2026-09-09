import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  isUsingInsecureSessionSecret,
  INSECURE_SESSION_SECRET_WARNING,
} from './session-secret-check';

const ENV_KEYS = ['PROMPT_AUTH_ENABLED', 'PROMPT_SESSION_SECRET', 'PROMPT_API_TOKEN'] as const;

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

describe('session-secret-check', () => {
  describe('isUsingInsecureSessionSecret', () => {
    it('is false when auth is not enabled, regardless of secrets', () => {
      setEnv('PROMPT_AUTH_ENABLED', undefined);
      setEnv('PROMPT_SESSION_SECRET', undefined);
      setEnv('PROMPT_API_TOKEN', undefined);
      assert.equal(isUsingInsecureSessionSecret(), false);
    });

    it('is true when auth is enabled and neither secret is set', () => {
      setEnv('PROMPT_AUTH_ENABLED', 'true');
      setEnv('PROMPT_SESSION_SECRET', undefined);
      setEnv('PROMPT_API_TOKEN', undefined);
      assert.equal(isUsingInsecureSessionSecret(), true);
    });

    it('is true when auth is enabled and secrets are blank strings', () => {
      setEnv('PROMPT_AUTH_ENABLED', 'yes');
      setEnv('PROMPT_SESSION_SECRET', '   ');
      setEnv('PROMPT_API_TOKEN', '');
      assert.equal(isUsingInsecureSessionSecret(), true);
    });

    it('is false when auth is enabled and PROMPT_SESSION_SECRET is set', () => {
      setEnv('PROMPT_AUTH_ENABLED', '1');
      setEnv('PROMPT_SESSION_SECRET', 'a-real-secret');
      setEnv('PROMPT_API_TOKEN', undefined);
      assert.equal(isUsingInsecureSessionSecret(), false);
    });

    it('is false when auth is enabled and only PROMPT_API_TOKEN is set', () => {
      setEnv('PROMPT_AUTH_ENABLED', '1');
      setEnv('PROMPT_SESSION_SECRET', undefined);
      setEnv('PROMPT_API_TOKEN', 'a-real-token');
      assert.equal(isUsingInsecureSessionSecret(), false);
    });
  });

  describe('INSECURE_SESSION_SECRET_WARNING', () => {
    it('names the env vars to set and where to look', () => {
      assert.match(INSECURE_SESSION_SECRET_WARNING, /PROMPT_SESSION_SECRET/);
      assert.match(INSECURE_SESSION_SECRET_WARNING, /docs\/configuration\.md/);
    });
  });
});
