import { readBrowserValue, writeBrowserValue } from './browser-storage';

/**
 * Bump the `-v1` suffix if the consent copy in NsfwConsentGate ever changes meaningfully
 * enough that previously-acknowledged users should see it again.
 */
export const NSFW_CONSENT_KEY = 'nsfw-generator-consent-ack-v1';

export function hasAckedNsfwConsent(): boolean {
  return readBrowserValue<boolean>(NSFW_CONSENT_KEY) === true;
}

export function ackNsfwConsent(): void {
  writeBrowserValue(NSFW_CONSENT_KEY, true);
}
