import { isAuthExplicitlyEnabled } from './auth/config';

/**
 * True when PROMPT_AUTH_ENABLED is on but neither PROMPT_SESSION_SECRET nor
 * PROMPT_API_TOKEN is set. In that state, getSessionSecret() (auth/config.ts) falls
 * back to a hardcoded string committed in this open-source repo - anyone who has read
 * the source can forge a valid, correctly-signed session cookie for any user, admin
 * included, on a deployment left in this state.
 */
export function isUsingInsecureSessionSecret(): boolean {
  if (!isAuthExplicitlyEnabled()) {
    return false;
  }
  const hasRealSecret = Boolean(
    process.env.PROMPT_SESSION_SECRET?.trim() || process.env.PROMPT_API_TOKEN?.trim()
  );
  return !hasRealSecret;
}

export const INSECURE_SESSION_SECRET_WARNING =
  'PROMPT_AUTH_ENABLED is true but PROMPT_SESSION_SECRET (and PROMPT_API_TOKEN) are unset. ' +
  'Session cookies are being signed with a hardcoded fallback secret from the public source ' +
  'code, so anyone who has read this repo could forge a valid session for any user, including ' +
  'admin. Set PROMPT_SESSION_SECRET to a long random string before exposing this beyond ' +
  'localhost - see docs/configuration.md.';
