import { getDefaultAdminUsername, isAuthExplicitlyEnabled } from './auth/config';

/**
 * True when PROMPT_AUTH_ENABLED is on but PROMPT_ADMIN_PASSWORD was never set. In that
 * state the bootstrap admin account (see syncDefaultAdminFromEnv in auth/store.ts) is
 * kept in sync with the literal default password ("admin") baked into this open-source
 * repo on every server start - default credentials are the single most common way a
 * self-hosted app like this actually gets compromised.
 */
export function isUsingDefaultAdminCredentials(): boolean {
  if (!isAuthExplicitlyEnabled()) {
    return false;
  }
  return !process.env.PROMPT_ADMIN_PASSWORD?.trim();
}

export function getDefaultAdminCredentialsWarning(): string {
  return (
    `PROMPT_AUTH_ENABLED is true but PROMPT_ADMIN_PASSWORD is unset, so the ` +
    `"${getDefaultAdminUsername()}" account is being kept on the well-known default ` +
    `password ("admin") baked into this open-source repo. Set PROMPT_ADMIN_PASSWORD to a ` +
    `strong value before exposing this beyond localhost - see docs/configuration.md.`
  );
}
