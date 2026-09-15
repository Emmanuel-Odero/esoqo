'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { useNavDrillIn } from '@/components/Shell';
import { actionModerateStore, actionUpdateStoreDetails } from '../../actions';

interface StoreSummary {
  id: string; name: string; slug: string; status: string;
  routingMode: string; posEnabled: boolean; themeKey: string;
}

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Live', DRAFT: 'Draft', SUSPENDED: 'Suspended' };

/**
 * The troubleshoot panel — everything a support call actually needs to
 * touch: rename a mistyped store, flip PoS on or off, or suspend/
 * reinstate. Kept separate from the read-only KPIs/orders/products so
 * this is the one place on the page that writes anything.
 */
export function StoreDetailPanel({
  store, canEdit, canModerate,
}: { store: StoreSummary; canEdit: boolean; canModerate: boolean }) {
  const [name, setName] = useState(store.name);
  const [posEnabled, setPosEnabled] = useState(store.posEnabled);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  useNavDrillIn('/estores/stores', name.trim() || store.name);

  const dirty = name.trim() !== store.name || posEnabled !== store.posEnabled;

  function save() {
    if (!name.trim()) return;
    setError(null);
    start(async () => {
      const r = await actionUpdateStoreDetails(store.id, { name: name.trim(), posEnabled });
      if (r.ok) announce('Store details saved', 'assertive');
      else setError(r.error);
    });
  }

  function moderate(status: 'ACTIVE' | 'SUSPENDED') {
    setError(null);
    start(async () => {
      const r = await actionModerateStore(store.id, status, status === 'SUSPENDED' ? reason : 'Reinstated by staff');
      if (r.ok) {
        announce(status === 'SUSPENDED' ? 'Store suspended' : 'Store reinstated', 'assertive');
        setSuspending(false); setReason('');
      } else setError(r.error);
    });
  }

  return (
    <div className="card">
      <div className="ctl">
        <h2 style={{ marginRight: 'auto' }}><Icon name="shop" size={18} />Store settings</h2>
        <span className={`pill ${STATUS_PILL[store.status]}`}>{STATUS_LABEL[store.status]}</span>
      </div>

      <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
        <div>
          <label className="sub" htmlFor="sd-name" style={{ display: 'block', marginBottom: 6 }}>Store name</label>
          <input id="sd-name" className="inp" style={{ width: '100%' }} value={name}
            onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <span className="sub" style={{ display: 'block', marginBottom: 6 }}>Address</span>
          <p className="mono" style={{ margin: 0, paddingTop: 10 }}>
            {store.routingMode === 'SUBDOMAIN' ? `${store.slug}.esoko.global` : `esoko.global/@${store.slug}`}
          </p>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, cursor: canEdit ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={posEnabled} onChange={(e) => setPosEnabled(e.target.checked)}
          disabled={!canEdit} style={{ accentColor: 'var(--green)' }} />
        <span>PoS terminal enabled</span>
      </label>

      {error && (
        <p className="pill p-bad" style={{ marginBottom: 14, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <div className="ctl" style={{ marginBottom: 0 }}>
        {canEdit && (
          <button className="btn btn-p btn-sm" onClick={save} disabled={pending || !dirty || !name.trim()}>
            <Icon name="check" size={14} />{pending ? 'Saving…' : 'Save changes'}
          </button>
        )}
        {canModerate && (
          store.status === 'SUSPENDED' ? (
            <button className="btn btn-o btn-sm" disabled={pending} onClick={() => moderate('ACTIVE')}>
              <Icon name="check-circle" size={14} />Reinstate
            </button>
          ) : (
            <button className="btn btn-o btn-sm" onClick={() => setSuspending(true)}>
              <Icon name="ban" size={14} />Suspend
            </button>
          )
        )}
      </div>

      {suspending && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <label className="sub" htmlFor="sd-reason" style={{ display: 'block', marginBottom: 6 }}>
            Reason for suspending (recorded in the audit log)
          </label>
          <textarea id="sd-reason" className="inp" rows={2} style={{ width: '100%', marginBottom: 10 }}
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Repeated customer complaints about undelivered orders" />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-d btn-sm" disabled={pending || !reason.trim()} onClick={() => moderate('SUSPENDED')}>
              {pending ? 'Suspending…' : 'Confirm suspend'}
            </button>
            <button className="btn btn-o btn-sm" onClick={() => { setSuspending(false); setReason(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
