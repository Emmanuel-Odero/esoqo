import { Icon } from '@esoko/ui';

const ACTOR_TYPES = [
  ['', 'All actors'], ['STAFF', 'Staff'], ['SUBJECT', 'Subject'],
  ['AGENT', 'Agent'], ['SYSTEM', 'System'], ['ISSUER', 'Issuer'],
] as const;

/**
 * A plain GET form, same pattern every other filtered list page in
 * this app already uses — no client component needed. Submitting
 * resets to page 1 implicitly (no page field here), which is the
 * right behaviour for a changed filter.
 */
export function AuditFilters({
  action, actorType, from, to,
}: { action: string; actorType: string; from: string; to: string }) {
  return (
    <form className="ctl">
      <div className="srch">
        <span className="mg"><Icon name="search" size={16} /></span>
        <input className="inp" name="action" defaultValue={action} aria-label="Search action"
          placeholder="Action contains… e.g. donation.confirmed" />
      </div>
      <select className="inp" name="actorType" aria-label="Filter by actor type" defaultValue={actorType}>
        {ACTOR_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input className="inp" type="date" name="from" defaultValue={from} aria-label="From date" />
      <input className="inp" type="date" name="to" defaultValue={to} aria-label="To date" />
      <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
      {(action || actorType || from || to) && (
        <a className="btn btn-o btn-sm" href="/audit">Clear</a>
      )}
    </form>
  );
}
