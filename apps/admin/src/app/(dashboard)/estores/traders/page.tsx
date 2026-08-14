import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoko/ui';
import { listStoreOwnersForStaff } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };

export default async function TradersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const { rows, total } = await listStoreOwnersForStaff(ctx, { search: sp.q, take: 50 });

  return (
    <>
      <div className="head">
        <div>
          <h1>Users &amp; traders</h1>
          <p>
            Everyone already selling on Esoko — a business only shows up here once it has opened
            at least one store. Having a business on file isn't the same as having gone live.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="user" size={16} /></span>
          <span className="n">{total}</span><span className="l">Traders selling</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="shop" size={16} /></span>
          <span className="n">{rows.reduce((n, r) => n + r.stores.length, 0)}</span><span className="l">Stores between them</span>
        </div>
      </div>

      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={sp.q ?? ''} aria-label="Search traders"
              placeholder="Name, business or work…" />
          </div>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="user" size={22} /></span>
            <h3>No traders yet</h3>
            <p style={{ margin: 0 }}>Nobody has opened a store on Esoko yet.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Trader</th><th>Work</th><th>County</th><th>Stores</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const name = r.party.person?.knownAs || r.party.person?.officialName
                  || r.party.organisation?.knownAs || r.party.organisation?.officialName || 'Unnamed';
                const contact = r.party.person?.msisdn ?? null;
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{name}</strong>
                      {contact && <span className="sub mono" style={{ display: 'block', fontSize: '.79rem' }}>{contact}</span>}
                    </td>
                    <td className="sub">{r.workRaw}{r.sector && ` · ${r.sector}`}</td>
                    <td>{r.party.county}</td>
                    <td>
                      {r.stores.map((s) => (
                        <Link key={s.id} href={`/estores/stores/${s.id}` as Route}
                          className="pill p-mute" style={{ marginRight: 6, marginBottom: 4, display: 'inline-flex' }}>
                          <span className={`pill ${STATUS_PILL[s.status]}`} style={{ padding: '1px 6px', marginRight: 6 }} />
                          {s.name}
                        </Link>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{rows.length} of {total} shown</p>
    </>
  );
}
