'use client';

import { useEffect, useState } from 'react';
import { ButtonLink, PrimaryButton } from '@/components/ui/Button';
import BrandMark from '@/components/BrandMark';
import { whenBrowserStorageReady } from '@/lib/browser-storage';
import { ackNsfwConsent, hasAckedNsfwConsent } from '@/lib/nsfw-consent';

/**
 * One-time acknowledgment gate in front of the adult generator plugin. The plugin is
 * already env-gated server- and client-side (see nsfw-generator-env.ts) — this is a
 * separate, narrower check: confirming the *person in the browser*, not just the deploy,
 * intends to be here. Acknowledgment is remembered in browser storage so it only shows
 * once per browser, not once per session.
 */
export default function NsfwConsentGate({ onAcknowledged }: { onAcknowledged: () => void }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void whenBrowserStorageReady().then(() => {
      if (cancelled) {
        return;
      }
      if (hasAckedNsfwConsent()) {
        onAcknowledged();
      } else {
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onAcknowledged]);

  if (!ready) {
    return null;
  }

  return (
    <div
      className="ui-overlay fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nsfw-consent-title"
      aria-describedby="nsfw-consent-body"
    >
      <div className="page-enter ui-modal-card w-full max-w-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <BrandMark
            size={32}
            withWordmark
            wordmarkClassName="type-brand type-heading tracking-tight"
          />
          <p className="ui-meta">Adult content</p>
        </div>
        <div className="space-y-3">
          <p id="nsfw-consent-title" className="type-display text-[1.5rem] sm:text-[1.65rem]">
            Confirm before continuing
          </p>
          <p id="nsfw-consent-body" className="type-body">
            This tool generates explicit adult imagery. It is built to describe consenting adults
            only — never minors, non-consent, or anything illegal — but you are responsible for what
            you generate and how you use it. By continuing you confirm:
          </p>
          <p className="type-body">
            You are 18 or older, or the age of majority where you live, whichever is higher —
            generating and viewing this content is legal for you where you are — and everything you
            generate here depicts consenting adults only.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <PrimaryButton
            className="ui-btn-sm"
            onClick={() => {
              ackNsfwConsent();
              onAcknowledged();
            }}
          >
            I confirm — continue
          </PrimaryButton>
          <ButtonLink href="/" size="sm" variant="ghost">
            Take me back
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
