import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { LiveRefresh } from '@/components/LiveRefresh';
import { actionListParcelLabelBatches, actionListParcelOrgs } from '../actions';
import { LabelWorkspace } from './LabelWorkspace';

export const dynamic = 'force-dynamic';

/** `?code=` opens straight into that label's attach form — how the
 *  topbar scanner lands here (see ScanBox). Since a scanned code always
 *  belongs to *some* pool, it skips the picker below and goes straight
 *  into the cross-company workspace, same as picking "Esoqo pool".
 *
 *  `?org=` (or `?tab=`/`?state=`/`?batch=`) means a company (or the
 *  Esoqo pool) has already been chosen — anything past that point goes
 *  to the Mint/Register/Batches workspace. Absent all four, this page
 *  shows the picker: which pool are you here to look at? Landing on
 *  the picker rather than everyone's labels at once is the same
 *  "companies first" shape the courier-company page now follows — see
 *  its own comment on why a summary before the rows matters. */
export default async function ParcelLabelsPage(
  { searchParams }: { searchParams: Promise<{ code?: string; org?: string; state?: string; batch?: string; tab?: string }> },
) {
  await requireStaff();
  const { code, org, state, batch, tab } = await searchParams;
  const choosingPool = !code && !org && !state && !batch && !tab;

  return (
    <>
      <LiveRefresh />
      <div className="head">
        <div>
          <h1>Labels</h1>
          <p>
            {choosingPool
              ? 'Pick a courier company or the shared Esoqo pool to see its label stock, register and batches.'
              : 'Manage this pool’s labels — mint new stock, browse the register, or withdraw/delete a batch.'}
          </p>
        </div>
      </div>

      {choosingPool ? (
        <PoolPicker />
      ) : (
        <LabelWorkspace
          basePath="/parcels/labels" orgId={org}
          code={code} state={state} batch={batch} tab={tab}
        />
      )}
    </>
  );
}

async function PoolPicker() {
  const [batches, orgs] = await Promise.all([
    actionListParcelLabelBatches(),
    actionListParcelOrgs(),
  ]);

  const countsByOrg = new Map<string, { unused: number; used: number; withdrawn: number }>();
  for (const b of batches) {
    const key = b.parcelOrgId ?? '';
    const cur = countsByOrg.get(key) ?? { unused: 0, used: 0, withdrawn: 0 };
    cur.unused += b.live;
    cur.used += b.used;
    cur.withdrawn += b.voided;
    countsByOrg.set(key, cur);
  }

  const pools: { id?: string; name: string; logoUrl?: string | null }[] = [
    { id: undefined, name: 'Esoqo pool (shared)' },
    ...orgs.map((o) => ({ id: o.id, name: o.name, logoUrl: o.logoUrl })),
  ];

  return (
    <div className="grid3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
      {pools.map((p) => {
        const counts = countsByOrg.get(p.id ?? '') ?? { unused: 0, used: 0, withdrawn: 0 };
        const href = (p.id ? `/parcels/labels?org=${p.id}` : '/parcels/labels?tab=register') as Route;
        return (
          <Link key={p.id ?? 'esoqo'} href={href} className="card"
            style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, textDecoration: 'none', color: 'inherit' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {p.logoUrl ? (
                <img src={p.logoUrl} alt="" style={{ height: 20, width: 20, objectFit: 'contain', borderRadius: 4 }} />
              ) : (
                <Icon name="qr" size={16} />
              )}
              {p.name}
            </strong>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Stat label="Unused" value={counts.unused} />
              <Stat label="Used" value={counts.used} />
              <Stat label="Withdrawn" value={counts.withdrawn} />
            </div>
            <span className="btn btn-o btn-sm" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
              View labels <Icon name="arrow-right" size={13} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="mono" style={{ fontSize: '1.3rem', display: 'block' }}>{value}</span>
      <span className="sub" style={{ fontSize: '.72rem' }}>{label}</span>
    </div>
  );
}
