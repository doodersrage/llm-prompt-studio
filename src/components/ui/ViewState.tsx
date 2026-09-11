import Link from 'next/link';
import type { ReactNode } from 'react';
import BrandMark from '@/components/BrandMark';
import { Button, PrimaryButton, Skeleton } from '@/components/ui/Button';

export type ViewStateIconName =
  'inbox' | 'search' | 'catalog' | 'compare' | 'diff' | 'preset' | 'template' | 'alert';

function ViewStateIconGlyph({ name }: { name: ViewStateIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'search':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case 'catalog':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'compare':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <rect x="4" y="5" width="6" height="14" rx="1.5" />
          <rect x="14" y="5" width="6" height="14" rx="1.5" />
        </svg>
      );
    case 'diff':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <path d="M8 6h8M8 12h5M8 18h8" />
          <path d="M16 12h4M18 10v4" />
        </svg>
      );
    case 'preset':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <path d="M6 4h12v16H6z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'template':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <path d="M7 4h10v4H7zM5 8h14v12H5z" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      );
    case 'alert':
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none" />
          <path d="M10.3 4.6 3.8 17.2A1.5 1.5 0 0 0 5.1 19.5h13.8a1.5 1.5 0 0 0 1.3-2.3L13.7 4.6a1.5 1.5 0 0 0-2.6 0z" />
        </svg>
      );
    case 'inbox':
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden {...common}>
          <path d="M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5H18A1.5 1.5 0 0 0 19.5 18V8.5" />
          <path d="M4 8.5 7.2 12h9.6L20 8.5" />
          <path d="M4 8.5V7A1.5 1.5 0 0 1 5.5 5.5h13A1.5 1.5 0 0 1 20 7v1.5" />
        </svg>
      );
  }
}

type ViewStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

function ViewStateActionButton({ action }: { action: ViewStateAction }) {
  if (action.href) {
    return (
      <Link href={action.href} className="ui-btn-primary">
        {action.label}
      </Link>
    );
  }

  return (
    <PrimaryButton type="button" onClick={action.onClick}>
      {action.label}
    </PrimaryButton>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  compact = false,
  branded = false,
  className = '',
}: {
  icon?: ViewStateIconName;
  title: string;
  description: ReactNode;
  action?: ViewStateAction;
  compact?: boolean;
  /** Quiet BrandMark above the icon well for product-owned empties. */
  branded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`ui-view-state ${compact ? 'ui-view-state-compact' : ''} ${className}`.trim()}
      role="status"
    >
      {branded ? (
        <div className="ui-view-state-brand">
          <BrandMark size={compact ? 28 : 36} />
        </div>
      ) : null}
      <div className="ui-view-state-icon">
        <ViewStateIconGlyph name={icon} />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className={`${compact ? 'type-heading' : 'type-title'}`}>{title}</h3>
        <p className="type-body">{description}</p>
      </div>
      {action ? <ViewStateActionButton action={action} /> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
  compact = false,
  className = '',
}: {
  title: string;
  description: ReactNode;
  action?: ViewStateAction;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`ui-view-state ui-view-state-error ${compact ? 'ui-view-state-compact' : ''} ${className}`.trim()}
      role="alert"
    >
      <div className="ui-view-state-icon">
        <ViewStateIconGlyph name="alert" />
      </div>
      <div className="max-w-md space-y-2">
        <h3 className={`${compact ? 'type-heading' : 'type-title'}`}>{title}</h3>
        <p className="type-body">{description}</p>
      </div>
      {action ? (
        action.href ? (
          <ViewStateActionButton action={action} />
        ) : (
          <Button variant="danger" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}

export function SuccessBanner({
  message,
  className = '',
}: {
  message: string;
  className?: string;
}) {
  return (
    <p
      className={`ui-view-state-success type-caption rounded-[var(--radius-md)] px-4 py-3 ${className}`.trim()}
      role="status"
    >
      {message}
    </p>
  );
}

export function isLikelyErrorStatus(message: string): boolean {
  return /failed|error|invalid|could not|unable/i.test(message);
}

export function HistoryCardSkeleton() {
  return (
    <div className="ui-skeleton-card" aria-hidden>
      <Skeleton className="ui-skeleton-block mb-0 h-40 w-full" />
      <div className="ui-skeleton-card-meta space-y-3">
        <Skeleton className="ui-skeleton-row w-2/5" />
        <Skeleton className="ui-skeleton-row w-full" />
        <Skeleton className="ui-skeleton-row w-4/5" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-8 w-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-8 w-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-8 w-16 rounded-[var(--radius-md)]" />
        </div>
      </div>
    </div>
  );
}

export function DataListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ui-list" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="ui-list-row">
          <div className="ui-list-primary space-y-2">
            <Skeleton className="ui-skeleton-row w-3/5" />
            <Skeleton className="ui-skeleton-row w-2/5" />
          </div>
          <Skeleton className="h-8 w-20 rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

export function CompareCardsSkeleton() {
  return (
    <div className="grid gap-[var(--block-gap)] lg:grid-cols-2" aria-hidden>
      {[0, 1].map(index => (
        <div key={index} className="ui-skeleton-card space-y-4">
          <Skeleton className="ui-skeleton-title w-2/5" />
          <Skeleton className="ui-skeleton-block h-48 w-full" />
        </div>
      ))}
    </div>
  );
}

export function StudioTabSkeleton() {
  return (
    <div className="ui-section-stack" role="status" aria-busy="true" aria-label="Loading studio">
      <div className="ui-meta-panel space-y-4">
        <Skeleton className="ui-skeleton-title w-32" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-20 rounded-[var(--radius-md)]" />
          ))}
        </div>
      </div>
      <div className="ui-card space-y-6 p-[var(--card-padding)]">
        <Skeleton className="ui-skeleton-title w-48" />
        <div className="ui-meta-panel space-y-4">
          <Skeleton className="ui-skeleton-row w-1/3" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-[var(--radius-md)]" />
            ))}
          </div>
        </div>
        <div className="ui-block-group">
          <HistoryCardSkeleton />
          <HistoryCardSkeleton />
        </div>
      </div>
    </div>
  );
}

export function ToolPageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="ui-section-stack" role="status" aria-busy="true" aria-label={label}>
      <div className="ui-card space-y-6 p-[var(--card-padding)]">
        <Skeleton className="ui-skeleton-title w-56" />
        <div className="ui-meta-panel space-y-4">
          <Skeleton className="ui-skeleton-row w-full" />
          <Skeleton className="ui-skeleton-row w-4/5" />
          <Skeleton className="h-28 w-full rounded-[var(--radius-md)]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-28 rounded-[var(--radius-md)]" />
          <Skeleton className="h-10 w-28 rounded-[var(--radius-md)]" />
        </div>
      </div>
    </div>
  );
}
