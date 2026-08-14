import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { CAPABILITY_CATALOGUE, PAYMENT_APPROVAL_THRESHOLD } from '@esoko/db';
import { mpesaProvider } from '@esoko/payments';
import { appEnv } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * There is no StoreSettings table — every actual per-store setting
 * (name, PoS, routing) is edited from that store's own page, and every
 * platform-wide price already lives in PricingRule. This page is the
 * other half a support conversation needs: what the surrounding system
 * is currently configured to do, read straight from what's running —
 * never a value someone could edit here and forget to also change
 * where it actually takes effect.
 */
export default async function EstoreSettingsPage() {
  await requireStaff();

  const commerceCaps = CAPABILITY_CATALOGUE.find((g) => g.group === 'Stores & commerce')?.items ?? [];
  // Show what the running code actually uses, not the raw env var — APP_ENV
  // forces console/storage-local even when live credentials are present.
  const mpesa = mpesaProvider();
  const mpesaLive = mpesa !== 'console';
  const storageProvider = process.env.STORAGE_PROVIDER ?? (appEnv() === 'development' ? 'local' : 'r2');
  const storageConfigured = Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID);

  return (
    <>
      <div className="head">
        <div>
          <h1>eStore settings</h1>
          <p>
            How the store and PoS system is actually configured right now — useful mid-troubleshoot,
            without a place to accidentally change something you meant to just check.
          </p>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 22 }}>
        <div className="card">
          <h2><Icon name="coins" size={18} />Payments</h2>
          <table className="tbl">
            <tbody>
              <tr>
                <td className="sub" style={{ width: 190 }}>M-Pesa provider</td>
                <td>
                  <span className={`pill ${mpesaLive ? 'p-ok' : 'p-warn'}`}>
                    {mpesa}
                  </span>
                  {!mpesaLive && <span className="sub" style={{ marginLeft: 8 }}>STK pushes are logged, not sent</span>}
                </td>
              </tr>
              <tr>
                <td className="sub">Payment approvals need</td>
                <td className="mono">{PAYMENT_APPROVAL_THRESHOLD} distinct signers</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2><Icon name="box" size={18} />Document storage</h2>
          <table className="tbl">
            <tbody>
              <tr>
                <td className="sub" style={{ width: 190 }}>R2 bucket</td>
                <td className="mono">{process.env.R2_BUCKET ?? 'esoko'}</td>
              </tr>
              <tr>
                <td className="sub">Provider</td>
                <td>
                  <span className={`pill ${storageProvider === 'r2' ? 'p-ok' : 'p-warn'}`}>
                    {storageProvider === 'r2' ? 'R2' : 'local disk'}
                  </span>
                  {storageProvider === 'local' && <span className="sub" style={{ marginLeft: 8 }}>dev files under .data/storage</span>}
                </td>
              </tr>
              <tr>
                <td className="sub">Credentials</td>
                <td>
                  <span className={`pill ${storageConfigured ? 'p-ok' : 'p-bad'}`}>
                    {storageConfigured ? 'Configured' : 'Not set'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ctl">
          <h2 style={{ marginRight: 'auto' }}><Icon name="key" size={18} />Stores &amp; commerce permissions</h2>
          <Link className="btn btn-o btn-sm" href="/staff">
            <Icon name="shield" size={13} />Grant or review on Staff &amp; permissions
          </Link>
        </div>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          What each capability in this section actually unlocks — the source of truth the role
          editor renders from.
        </p>
        <table className="tbl">
          <thead><tr><th>Capability</th><th>Unlocks</th></tr></thead>
          <tbody>
            {commerceCaps.map(([key, label]) => (
              <tr key={key}>
                <td className="mono">{key}</td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
