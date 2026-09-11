import { Icon } from '@esoko/ui';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Landed on only when a staff account's capabilities matched none of
 *  NAV_ROUTES — every other case sends them straight to the first
 *  section they can actually open (see the dashboard root's redirect).
 *  A real account should never end up here; if one does, it's
 *  configured with no read capability at all and needs a role fix,
 *  not a crash. */
export default async function NoAccessPage() {
  await requireStaff();
  return (
    <>
      <div className="head">
        <div>
          <h1>No sections available</h1>
          <p>Your account isn&rsquo;t granted a capability for any dashboard section yet.</p>
        </div>
      </div>
      <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)' }}>
        <Icon name="info" size={18} />
        <span>Ask whoever manages Staff &amp; permissions to grant you at least one read capability.</span>
      </div>
    </>
  );
}
