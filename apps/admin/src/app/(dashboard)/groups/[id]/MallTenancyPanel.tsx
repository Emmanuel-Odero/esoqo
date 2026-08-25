'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import {
  actionFindTenantByPhone, actionAddTenant, actionEndTenancy, actionSetMallSlug,
} from '../actions';

interface Tenancy {
  id: string; unitLabel: string | null; endedAt: string | null; startedAt: string;
  tenantWork: string; stores: { id: string; name: string; slug: string; status: string }[];
}

/** Shown on a MALL organisation's detail page — the tenant roster and
 *  the slug its public /m/[mallSlug] directory is served at. Adding a
 *  tenant is a two-step lookup (phone → their enterprises) since a
 *  mall's tenants are Enterprises, not whole organisations. */
export function MallTenancyPanel({
  mallOrgId, mallSlug: initialSlug, tenancies: initialTenancies,
}: { mallOrgId: string; mallSlug: string | null; tenancies: Tenancy[] }) {
  const [tenancies, setTenancies] = useState(initialTenancies);
  const [slug, setSlug] = useState(initialSlug ?? '');
  const [slugError, setSlugError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [candidates, setCandidates] = useState<{ id: string; workRaw: string }[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [unitLabel, setUnitLabel] = useState('');
  const [pending, startTransition] = useTransition();

  const active = tenancies.filter((t) => !t.endedAt);
  const ended = tenancies.filter((t) => t.endedAt);

  function saveSlug() {
    setSlugError(null);
    startTransition(async () => {
      const res = await actionSetMallSlug(mallOrgId, slug);
      if (!res.ok) setSlugError(res.error);
    });
  }

  function lookup() {
    setLookupError(null);
    setCandidates(null);
    startTransition(async () => {
      const res = await actionFindTenantByPhone(phone);
      if (!res.ok) { setLookupError(res.error); return; }
      setCandidates(res.enterprises);
    });
  }

  function addTenant(tenantEnterpriseId: string) {
    startTransition(async () => {
      const res = await actionAddTenant(mallOrgId, tenantEnterpriseId, unitLabel || undefined);
      if (!res.ok) { setLookupError(res.error); return; }
      setCandidates(null); setPhone(''); setUnitLabel('');
      // Optimistic-ish: just re-derive from a full reload via revalidatePath
      // isn't visible client-side, so nudge the parent to refetch by
      // reloading the page's server data on next navigation. Simplest
      // correct thing here is a hard refresh of this panel's own list.
      window.location.reload();
    });
  }

  function end(tenancyId: string) {
    if (!confirm('End this tenancy?')) return;
    startTransition(async () => {
      const res = await actionEndTenancy(tenancyId);
      if (res.ok) {
        setTenancies((ts) => ts.map((t) => (t.id === tenancyId ? { ...t, endedAt: new Date().toISOString() } : t)));
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h2><Icon name="grid" size={17} />Mall tenancy</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label className="sub" htmlFor="mall-slug" style={{ display: 'block', marginBottom: 6 }}>
            Public directory slug (/m/…)
          </label>
          <input id="mall-slug" className="inp" value={slug} onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. westgate-mall" style={{ width: 220 }} />
        </div>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={saveSlug}>Save slug</button>
        {slugError && <span className="sub" style={{ color: 'var(--red)' }}>{slugError}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label className="sub" htmlFor="tenant-phone" style={{ display: 'block', marginBottom: 6 }}>
            Add tenant — phone number
          </label>
          <input id="tenant-phone" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="07…" style={{ width: 160 }} />
        </div>
        <div>
          <label className="sub" htmlFor="unit-label" style={{ display: 'block', marginBottom: 6 }}>Unit (optional)</label>
          <input id="unit-label" className="inp" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)}
            placeholder="Shop 14B" style={{ width: 140 }} />
        </div>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={lookup}>Look up</button>
        {lookupError && <span className="sub" style={{ color: 'var(--red)' }}>{lookupError}</span>}
      </div>

      {candidates && candidates.length > 0 && (
        <div className="card" style={{ padding: 10, marginBottom: 16, background: 'var(--bg-2)' }}>
          <p className="sub" style={{ marginTop: 0 }}>Which business?</p>
          {candidates.map((c) => (
            <button key={c.id} className="btn btn-p btn-sm" style={{ marginRight: 8, marginBottom: 6 }}
              disabled={pending} onClick={() => addTenant(c.id)}>
              {c.workRaw}
            </button>
          ))}
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>Tenant</th><th>Unit</th><th>Store</th><th>Since</th><th /></tr></thead>
        <tbody>
          {active.length === 0 ? (
            <tr><td colSpan={5} className="empty">No active tenants yet.</td></tr>
          ) : active.map((t) => (
            <tr key={t.id}>
              <td>{t.tenantWork}</td>
              <td className="sub">{t.unitLabel ?? '—'}</td>
              <td className="sub">{t.stores[0] ? t.stores[0].name : '— no store yet —'}</td>
              <td className="mono sub" style={{ fontSize: '.79rem' }}>{t.startedAt.slice(0, 10)}</td>
              <td>
                <button className="btn btn-o btn-sm" disabled={pending} onClick={() => end(t.id)}>End</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {ended.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="sub" style={{ cursor: 'pointer' }}>{ended.length} past tenant{ended.length !== 1 ? 's' : ''}</summary>
          <table className="tbl" style={{ marginTop: 8 }}>
            <tbody>
              {ended.map((t) => (
                <tr key={t.id}>
                  <td>{t.tenantWork}</td>
                  <td className="sub">{t.unitLabel ?? '—'}</td>
                  <td className="mono sub" style={{ fontSize: '.79rem' }}>
                    ended {t.endedAt?.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
