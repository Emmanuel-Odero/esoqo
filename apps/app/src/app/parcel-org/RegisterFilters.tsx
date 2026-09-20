'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';

/**
 * The register's filter bar.
 *
 * A plain GET form was here before, and every Filter click was a full
 * browser reload — styles, scroll and all. This submits through the
 * App Router instead: same query string, soft navigation, no reload.
 * Sort/order/perPage ride along untouched; page resets to 1 because a
 * new filter's page 3 is meaningless.
 */
export function RegisterFilters({
  status, q, parcelType, overdueOnly, originMethod,
}: {
  status?: string;
  q?: string;
  parcelType?: string;
  overdueOnly: boolean;
  originMethod?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sp = new URLSearchParams(current.toString());
    const setOrClear = (key: string, value: string | null) => {
      if (value && value.trim() !== '') sp.set(key, value.trim());
      else sp.delete(key);
    };
    setOrClear('q', fd.get('q') as string | null);
    setOrClear('status', fd.get('status') as string | null);
    setOrClear('parcelType', fd.get('parcelType') as string | null);
    if (fd.get('overdue')) sp.set('overdue', '1');
    else sp.delete('overdue');
    if (originMethod) sp.set('originMethod', originMethod);
    sp.set('page', '1');
    const qs = sp.toString();
    router.push((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  }

  return (
    <form className="porg-filters" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="porg-q">Search code, name or phone</label>
      <input
        id="porg-q" name="q" defaultValue={q ?? ''} className="inp mono porg-search"
        placeholder="Search code, your number, name or phone"
      />
      <label className="sr-only" htmlFor="porg-status">Filter by status</label>
      {/* A multi-status filter arriving from a KPI tile
          ("BOOKED,RECEIVED_AT_COUNTER") matches no single option, so
          the select would silently show "All statuses" over a
          filtered list. The extra option names what is actually
          applied, and Clear filter above is the way out of it. */}
      <select id="porg-status" name="status" defaultValue={status ?? ''} className="inp mono porg-status">
        <option value="">All statuses</option>
        {status?.includes(',') && <option value={status}>From the board above</option>}
        <option value="DRAFT_PENDING_PAYMENT">Awaiting payment</option>
        <option value="BOOKED">Waiting for a rider</option>
        <option value="RECEIVED_AT_COUNTER">At the station</option>
        <option value="PICKED_UP">Picked up</option>
        <option value="IN_TRANSIT">On the way</option>
        <option value="FAILED_DELIVERY">Delivery attempted</option>
        <option value="HELD_AT_AGENT">At a pickup point</option>
        <option value="DELIVERED">Delivered</option>
        <option value="RETURNED_TO_SENDER">Returned to sender</option>
        <option value="CANCELLED">Cancelled</option>
      </select>
      <label className="sr-only" htmlFor="porg-type">Filter by parcel type</label>
      <select id="porg-type" name="parcelType" defaultValue={parcelType ?? ''} className="inp mono porg-status">
        <option value="">All types</option>
        <option value="DOCUMENT">Documents</option>
        <option value="SMALL">Small</option>
        <option value="MEDIUM">Medium</option>
        <option value="LARGE">Large</option>
        <option value="BULKY">Bulky</option>
      </select>
      <label className="porg-check">
        <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} />
        Overdue only
      </label>
      <button className="btn btn-o btn-sm" type="submit">
        <Icon name="filter" size={15} />Filter
      </button>
    </form>
  );
}
