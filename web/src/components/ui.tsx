/** Small shared UI primitives. */
import { type ReactNode, useEffect, useRef } from 'react';
import { errorMessage } from '../services/http';
import type { PageMeta, RiskLevel } from '../types/api';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="subtle">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…', height = 120 }: { label?: string; height?: number }) {
  return (
    <div role="status" aria-live="polite">
      <div className="skeleton" style={{ height }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <strong>Couldn’t load this data</strong>
      <span>{errorMessage(error)}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {children && <span className="subtle">{children}</span>}
    </div>
  );
}

/**
 * Renders loading / error / empty / content for a TanStack Query result,
 * so every data view handles all four states the same way.
 */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  loadingHeight,
  children,
}: {
  query: {
    data: T | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  loadingHeight?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Loading height={loadingHeight} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const d = query.data as T;
  if (isEmpty?.(d)) return <>{empty ?? <EmptyState title="No data yet" />}</>;
  return <>{children(d)}</>;
}

const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'Low risk',
  MEDIUM: 'Medium risk',
  HIGH: 'High risk',
};
const RISK_ICON: Record<RiskLevel, string> = { LOW: '●', MEDIUM: '▲', HIGH: '■' };

/** Status color + shape + text: risk is never communicated by color alone. */
export function RiskBadge({ level, score }: { level: RiskLevel | null; score?: number | null }) {
  if (!level) return <span className="badge">Not evaluated</span>;
  return (
    <span className={`badge badge-${level.toLowerCase()}`} title={RISK_LABEL[level]}>
      <span aria-hidden="true" style={{ fontSize: 9 }}>
        {RISK_ICON[level]}
      </span>
      {RISK_LABEL[level]}
      {score !== undefined && score !== null && <span className="num">· {score}</span>}
    </span>
  );
}

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (p: number) => void }) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <div className="pagination">
      <span className="subtle">
        {from}–{to} of {meta.total}
      </span>
      <div className="row">
        <button
          className="btn btn-sm"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </button>
        <span className="subtle">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          className="btn btn-sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="card-header">
          <h2>{title}</h2>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert-box error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v}%`;
export const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
