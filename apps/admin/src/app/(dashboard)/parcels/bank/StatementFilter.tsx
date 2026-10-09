import { Icon } from '@esoqo/ui';

/**
 * A plain GET form, same pattern the audit log's own date filter
 * uses (AuditFilters) — no client component needed.
 */
export function StatementFilter({ start, end }: { start: string; end: string }) {
  return (
    <form className="ctl" action="/parcels/bank">
      <input className="inp" type="date" name="start" defaultValue={start} aria-label="From date" />
      <input className="inp" type="date" name="end" defaultValue={end} aria-label="To date" />
      <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
    </form>
  );
}
