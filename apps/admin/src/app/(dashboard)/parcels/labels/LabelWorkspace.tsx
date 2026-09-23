import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import {
  actionListParcelLabelBatches, actionListParcelLabelRegister,
  actionListParcelLabelStock, actionListParcelOrgs,
} from '../actions';
import { BatchesPanel } from './BatchesPanel';
import { LabelStockPanel } from './LabelStockPanel';
import { RegisterPanel } from './RegisterPanel';

export type LabelTab = 'register' | 'mint' | 'batches';
const TABS: { key: LabelTab; label: string; icon: 'document' | 'qr' | 'box' }[] = [
  { key: 'register', label: 'Register', icon: 'document' },
  { key: 'mint', label: 'Mint', icon: 'qr' },
  { key: 'batches', label: 'Batches', icon: 'box' },
];

/**
 * The Mint/Register/Batches workspace, shared by the cross-company
 * `/parcels/labels` page (reached after picking a company or Esoqo pool)
 * and a company's own `/parcels/companies/[id]/labels` drill-in — same
 * three tabs, same components, only `basePath` and whether `org` is
 * switchable differ.
 */
export async function LabelWorkspace({
  basePath, orgId, lockOrg, code, state, batch, tab,
}: {
  basePath: string;
  orgId?: string;
  /** True on the company-scoped route: the "stock belongs to" switcher
   *  is pointless (and misleading) when the whole page is already one
   *  company's — org is fixed by the URL, not a query param. */
  lockOrg?: boolean;
  code?: string;
  state?: string;
  batch?: string;
  tab?: string;
}) {
  const ctx = await requireStaff();
  const canGenerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.assign');
  const registerState = state ?? 'blank';
  // A scanned code always opens the attach-info modal, which lives on
  // the Mint tab (see LabelStockPanel) — same "scan lands on the form"
  // gesture as before the tabs existed.
  const activeTab: LabelTab = code ? 'mint' : (tab === 'mint' || tab === 'batches' ? tab : 'register');

  const [unused, batches, orgs, register] = await Promise.all([
    actionListParcelLabelStock(orgId),
    actionListParcelLabelBatches(orgId),
    actionListParcelOrgs(),
    actionListParcelLabelRegister(registerState, orgId),
  ]);
  const emptyCount = register.counts['blank'] ?? 0;
  const attachedCount = (register.counts['filled'] ?? 0) + (register.counts['spent'] ?? 0);
  // Which pool every tab below is scoped to — shown once here, above
  // the tabs, rather than only inside Mint's own "stock belongs to"
  // line, so it stays visible while browsing Register or Batches too.
  // This is exactly the thing a wrong click here is expensive to get
  // wrong — see the register's own org-scoping bug this was written
  // right after fixing.
  const activeOrg = orgId ? orgs.find((o) => o.id === orgId) : undefined;

  function tabHref(t: LabelTab): Route {
    const params = new URLSearchParams();
    if (t === 'register' && state) params.set('state', state);
    if (t !== 'register') params.set('tab', t);
    const qs = params.toString();
    return (qs ? `${basePath}?${qs}` : basePath) as Route;
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '10px 14px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10,
      }}>
        {activeOrg?.logoUrl ? (
          <img src={activeOrg.logoUrl} alt="" style={{
            height: 32, width: 32, objectFit: 'contain', borderRadius: 6,
            background: '#fff', border: '1px solid var(--line)',
          }} />
        ) : (
          <span style={{
            height: 32, width: 32, display: 'grid', placeItems: 'center',
            borderRadius: 6, background: '#fff', border: '1px solid var(--line)', flexShrink: 0,
          }}>
            <Icon name="qr" size={16} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="sub" style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Viewing labels for
          </div>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeOrg?.name ?? 'Esoqo pool (shared)'}
          </strong>
        </div>
        {basePath === '/parcels/labels' && (
          <Link href={'/parcels/labels' as Route} className="btn btn-o btn-sm" style={{ marginLeft: 'auto' }}>
            Change company
          </Link>
        )}
      </div>

      <p className="sub" style={{ margin: '0 0 16px' }}>
        Empty labels ({emptyCount}) are printed stock waiting for a box;
        attached labels ({attachedCount}) already carry item info or a booking.
        Print a batch of PKG-… codes ahead of any booking — stick one on an envelope or a
        box in advance, then hand the code over at booking (or have the sender scan it)
        instead of every physical label having to be printed fresh at checkout time.
      </p>

      <nav className="tabnav" aria-label="Label workspaces">
        {TABS.map((t) => (
          <Link key={t.key} href={tabHref(t.key)} className={`tabnav-item${t.key === activeTab ? ' active' : ''}`}
            aria-current={t.key === activeTab ? 'page' : undefined}>
            <Icon name={t.icon} size={14} />{t.label}
          </Link>
        ))}
      </nav>

      {activeTab === 'mint' && (
        <LabelStockPanel
          canGenerate={canGenerate} unused={unused} openCode={code}
          orgs={orgs} activeOrgId={orgId} lockOrg={lockOrg} basePath={basePath}
        />
      )}
      {activeTab === 'register' && (
        <RegisterPanel
          labels={register.labels} counts={register.counts}
          state={registerState} orgId={orgId} batchFilter={batch} basePath={basePath}
        />
      )}
      {activeTab === 'batches' && (
        <BatchesPanel batches={batches} orgId={orgId} basePath={basePath} />
      )}
    </>
  );
}
