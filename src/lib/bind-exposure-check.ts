import { isAuthExplicitlyEnabled } from './auth/config';
import { isDesktopShellServer } from './desktop-shell';
import {
  getDefaultAdminCredentialsWarning,
  isUsingDefaultAdminCredentials,
} from './default-admin-check';
import {
  INSECURE_SESSION_SECRET_WARNING,
  isUsingInsecureSessionSecret,
} from './session-secret-check';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function flagEnabled(value: string | undefined | null): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** Opt-out for CI / emergency recovery. Never use on a reachable network. */
export function isInsecureAuthExplicitlyAllowed(): boolean {
  return flagEnabled(process.env.PROMPT_ALLOW_INSECURE_AUTH);
}

function hostnameFromUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return true;
  }
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(hostname.trim().toLowerCase())) {
    return true;
  }
  if (host === '0.0.0.0' || host === '::') {
    return false;
  }
  return host.endsWith('.localhost');
}

/**
 * True when operators have signaled this process is reachable beyond loopback
 * (compose `--profile exposed`, public PROMPT_API_URL, or an all-interfaces bind).
 * Desktop shells always count as local.
 */
export function isNetworkExposedDeployment(): boolean {
  if (isDesktopShellServer()) {
    return false;
  }
  if (flagEnabled(process.env.PROMPT_EXPOSED)) {
    return true;
  }

  const bindHost = (
    process.env.PROMPT_BIND_HOST?.trim() ||
    process.env.HOSTNAME?.trim() ||
    process.env.HOST?.trim() ||
    ''
  ).toLowerCase();
  if (bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '[::]' || bindHost === '*') {
    return true;
  }

  const apiHost = hostnameFromUrl(process.env.PROMPT_API_URL);
  if (apiHost && !isLoopbackHostname(apiHost)) {
    return true;
  }

  return false;
}

export const AUTH_OFF_EXPOSED_ERROR =
  'Auth is off (PROMPT_AUTH_ENABLED unset/false) but this process looks network-exposed ' +
  '(PROMPT_EXPOSED, HOSTNAME/HOST/PROMPT_BIND_HOST is 0.0.0.0/::, or PROMPT_API_URL is not ' +
  'loopback). Auth-off is localhost-only. Set PROMPT_AUTH_ENABLED=true with ' +
  'PROMPT_SESSION_SECRET and PROMPT_ADMIN_PASSWORD, use docker compose --profile exposed, ' +
  'or set PROMPT_ALLOW_INSECURE_AUTH=1 only for emergency recovery. See docs/configuration.md.';

/**
 * Fail closed when auth is enabled with insecure defaults, or when auth is off
 * on a network-exposed bind. Returns null when startup may continue.
 */
export function getSecureExposureViolation(): string | null {
  if (isInsecureAuthExplicitlyAllowed()) {
    return null;
  }

  if (isUsingInsecureSessionSecret()) {
    return INSECURE_SESSION_SECRET_WARNING;
  }

  if (isUsingDefaultAdminCredentials()) {
    return getDefaultAdminCredentialsWarning();
  }

  if (!isAuthExplicitlyEnabled() && isNetworkExposedDeployment()) {
    return AUTH_OFF_EXPOSED_ERROR;
  }

  return null;
}

export function assertSecureExposureOrThrow(): void {
  const violation = getSecureExposureViolation();
  if (!violation) {
    return;
  }
  throw new Error(`[security] ${violation}`);
}
