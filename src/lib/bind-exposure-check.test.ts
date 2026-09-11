import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  AUTH_OFF_EXPOSED_ERROR,
  assertSecureExposureOrThrow,
  getSecureExposureViolation,
  isInsecureAuthExplicitlyAllowed,
  isNetworkExposedDeployment,
} from './bind-exposure-check';

const ENV_KEYS = [
  'PROMPT_AUTH_ENABLED',
  'PROMPT_SESSION_SECRET',
  'PROMPT_API_TOKEN',
  'PROMPT_ADMIN_PASSWORD',
  'PROMPT_EXPOSED',
  'PROMPT_BIND_HOST',
  'PROMPT_API_URL',
  'PROMPT_ALLOW_INSECURE_AUTH',
  'PROMPT_DESKTOP',
  'HOSTNAME',
  'HOST',
] as const;

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

function clearSecurityEnv(): void {
  for (const key of ENV_KEYS) {
    setEnv(key, undefined);
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    setEnv(key, originalEnv[key]);
  }
});

describe('bind-exposure-check', () => {
  describe('isNetworkExposedDeployment', () => {
    it('is false for desktop shells even when PROMPT_EXPOSED is set', () => {
      clearSecurityEnv();
      setEnv('PROMPT_DESKTOP', '1');
      setEnv('PROMPT_EXPOSED', 'true');
      assert.equal(isNetworkExposedDeployment(), false);
    });

    it('is true when PROMPT_EXPOSED is set', () => {
      clearSecurityEnv();
      setEnv('PROMPT_EXPOSED', '1');
      assert.equal(isNetworkExposedDeployment(), true);
    });

    it('is true when bind host is all-interfaces', () => {
      clearSecurityEnv();
      setEnv('PROMPT_BIND_HOST', '0.0.0.0');
      assert.equal(isNetworkExposedDeployment(), true);
      setEnv('PROMPT_BIND_HOST', undefined);
      setEnv('HOSTNAME', '::');
      assert.equal(isNetworkExposedDeployment(), true);
    });

    it('is true when PROMPT_API_URL points at a public host', () => {
      clearSecurityEnv();
      setEnv('PROMPT_API_URL', 'https://studio.example.com');
      assert.equal(isNetworkExposedDeployment(), true);
    });

    it('is false for loopback PROMPT_API_URL and unset exposure flags', () => {
      clearSecurityEnv();
      setEnv('PROMPT_API_URL', 'http://127.0.0.1:47832');
      assert.equal(isNetworkExposedDeployment(), false);
    });
  });

  describe('getSecureExposureViolation', () => {
    it('is null for localhost auth-off defaults', () => {
      clearSecurityEnv();
      assert.equal(getSecureExposureViolation(), null);
    });

    it('fails when auth is on without a real session secret', () => {
      clearSecurityEnv();
      setEnv('PROMPT_AUTH_ENABLED', 'true');
      setEnv('PROMPT_ADMIN_PASSWORD', 'strong-password');
      assert.match(getSecureExposureViolation() ?? '', /PROMPT_SESSION_SECRET/);
    });

    it('fails when auth is on without PROMPT_ADMIN_PASSWORD', () => {
      clearSecurityEnv();
      setEnv('PROMPT_AUTH_ENABLED', 'true');
      setEnv('PROMPT_SESSION_SECRET', 'a-real-secret');
      assert.match(getSecureExposureViolation() ?? '', /PROMPT_ADMIN_PASSWORD/);
    });

    it('fails when auth is off on an exposed bind', () => {
      clearSecurityEnv();
      setEnv('PROMPT_EXPOSED', 'true');
      assert.equal(getSecureExposureViolation(), AUTH_OFF_EXPOSED_ERROR);
    });

    it('is null when auth is on with real secrets, even if exposed', () => {
      clearSecurityEnv();
      setEnv('PROMPT_EXPOSED', 'true');
      setEnv('PROMPT_AUTH_ENABLED', 'true');
      setEnv('PROMPT_SESSION_SECRET', 'a-real-secret');
      setEnv('PROMPT_ADMIN_PASSWORD', 'a-strong-password');
      assert.equal(getSecureExposureViolation(), null);
    });

    it('honors PROMPT_ALLOW_INSECURE_AUTH', () => {
      clearSecurityEnv();
      setEnv('PROMPT_EXPOSED', 'true');
      setEnv('PROMPT_ALLOW_INSECURE_AUTH', '1');
      assert.equal(isInsecureAuthExplicitlyAllowed(), true);
      assert.equal(getSecureExposureViolation(), null);
    });
  });

  describe('assertSecureExposureOrThrow', () => {
    it('throws with a [security] prefix', () => {
      clearSecurityEnv();
      setEnv('PROMPT_EXPOSED', 'true');
      assert.throws(() => assertSecureExposureOrThrow(), /\[security\]/);
    });

    it('does not throw on safe localhost defaults', () => {
      clearSecurityEnv();
      assert.doesNotThrow(() => assertSecureExposureOrThrow());
    });
  });
});
