import Link from 'next/link';
import { Icon } from '@esoko/ui';

export interface PagerFilters { action?: string; actorType?: string; from?: string; to?: string }

/**
 * Page-based navigation, not infinite scroll — a regulator (or anyone
 * chasing down one specific event) needs to land on page 40 directly,
 * not scroll-and-hope. Takes the active filters as props and rebuilds
 * the full query string itself, rather than a bare "?page=N" — that
 * pattern (used elsewhere in this app) silently drops every other
 * filter the moment someone pages past screen one.
 */
export function Pager({
  page, pages, filters,
}: { page: number; pages: number; filters: PagerFilters }) {
  if (pages <= 1) return null;

  function hrefFor(p: number): string {
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.actorType) params.set('actorType', filters.actorType);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    params.set('page', String(p));
    return `?${params.toString()}`;
  }

  return (
    <nav className="ctl" style={{ marginTop: 16, justifyContent: 'center' }} aria-label="Pagination">
      <PageLink href={hrefFor(Math.max(1, page - 1))} disabled={page === 1}>
        <Icon name="arrow-left" size={14} />Previous
      </PageLink>
      <span className="mono sub">Page {page} of {pages}</span>
      <PageLink href={hrefFor(Math.min(pages, page + 1))} disabled={page === pages}>
        Next<Icon name="arrow-right" size={14} />
      </PageLink>
    </nav>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className="btn btn-o btn-sm" aria-disabled style={{ opacity: 0.45, pointerEvents: 'none' }}>{children}</span>;
  }
  return <Link className="btn btn-o btn-sm" href={href} scroll={false}>{children}</Link>;
}
