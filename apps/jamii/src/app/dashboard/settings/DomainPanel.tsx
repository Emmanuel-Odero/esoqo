'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionRequestDomain, actionRemoveDomain } from '../actions';

export interface DomainInfo {
  hostname: string;
  status: 'PENDING_DNS' | 'VERIFYING' | 'ACTIVE' | 'FAILED' | 'SUSPENDED';
  verificationToken: string;
  failureReason: string | null;
  removedAt: string | null;
}

const CLOUDFLARE_FALLBACK_ORIGIN =
  process.env.NEXT_PUBLIC_JAMII_DOMAIN_TARGET ?? 'sites.ourjamii.co.ke';

/**
 * The "Live at" link needs a different origin locally than in
 * production: a real custom domain gets real TLS on :443 via
 * Cloudflare, so `https://{hostname}` (no port) is correct there — but
 * a dev box has no TLS termination and apps/jamii's dev server isn't
 * on :443, so that exact link 404s/times out when clicked locally.
 *
 * `https://{hostname}` is also what the server-rendered HTML always
 * has (it has no window to check), so the local override is applied
 * only after mount — matching the SSR markup on first paint avoids a
 * hydration mismatch, and the correction happens before anyone's had
 * a chance to click anyway.
 */
function useLocalDevOrigin(): { protocol: string; port: string } | null {
  const [origin, setOrigin] = useState<{ protocol: string; port: string } | null>(null);
  useEffect(() => {
    const { hostname, protocol, port } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') setOrigin({ protocol, port });
  }, []);
  return origin;
}

const STATUS_COPY: Record<DomainInfo['status'], { label: string; tone: string }> = {
  PENDING_DNS: { label: 'Waiting for DNS records', tone: '#a06a1f' },
  VERIFYING: { label: 'Checking your records…', tone: '#a06a1f' },
  ACTIVE: { label: 'Live', tone: '#2f7a3d' },
  FAILED: { label: 'Verification failed', tone: 'var(--stamp)' },
  SUSPENDED: { label: 'Suspended by Esoko', tone: 'var(--stamp)' },
};

/**
 * Settings → "Link your own domain". Deliberately shows exact DNS
 * records rather than a wizard — the group's own registrar (GoDaddy,
 * Truehost, whoever) is where they'll actually add these, so copy-paste
 * accuracy matters more than hand-holding.
 */
export function DomainPanel({ pageId, initial }: { pageId: string; initial: DomainInfo | null }) {
  const [domain, setDomain] = useState(initial);
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const localDevOrigin = useLocalDevOrigin();

  // Waiting on DNS propagation / Cloudflare's own check isn't something
  // a click can resolve — a light poll while unresolved keeps the
  // status honest without the group needing to keep refreshing.
  useEffect(() => {
    if (!domain || domain.status === 'ACTIVE' || domain.status === 'SUSPENDED') return;
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [domain, router]);

  useEffect(() => setDomain(initial), [initial]);

  function request() {
    setError(null);
    startTransition(async () => {
      const result = await actionRequestDomain(pageId, { hostname });
      if (!result.ok) { setError(result.error); return; }
      setHostname('');
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await actionRemoveDomain(pageId);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640, marginBottom: 20 }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--ink)', marginBottom: 4 }}>Your own domain</h3>
      <p style={{ fontSize: '.84rem', color: '#6b6552', margin: '0 0 16px' }}>
        Point a domain you own (e.g. <b>mchamawetu.org</b>) at this page — visitors see
        your domain in the address bar; the page, donations and dashboard stay exactly as
        they are.
      </p>

      {!domain && (
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text" placeholder="mchamawetu.org" value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd6c4', borderRadius: 8 }}
          />
          <button className="btn btn-stamp" disabled={pending || !hostname.trim()} onClick={request}>
            Link domain
          </button>
        </div>
      )}

      {domain && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 600 }}>{domain.hostname}</span>
            <span style={{ fontSize: '.78rem', fontWeight: 600, color: STATUS_COPY[domain.status].tone }}>
              ● {STATUS_COPY[domain.status].label}
            </span>
          </div>

          {domain.status === 'ACTIVE' && (
            <p style={{ fontSize: '.85rem', margin: '0 0 12px' }}>
              Live at{' '}
              <a
                href={localDevOrigin
                  ? `${localDevOrigin.protocol}//${domain.hostname}${localDevOrigin.port ? `:${localDevOrigin.port}` : ''}`
                  : `https://${domain.hostname}`}
                target="_blank" rel="noreferrer"
              >
                {domain.hostname} ↗
              </a>
            </p>
          )}

          {(domain.status === 'PENDING_DNS' || domain.status === 'VERIFYING') && (
            <div style={{ fontSize: '.83rem', marginBottom: 14 }}>
              <p style={{ margin: '0 0 8px' }}>Add these two records at your domain's registrar/DNS provider:</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 8px 4px 0', color: '#6b6552' }}>CNAME</td>
                    <td style={{ padding: '4px 8px' }}>{domain.hostname}</td>
                    <td style={{ padding: '4px 0', wordBreak: 'break-all' }}>{CLOUDFLARE_FALLBACK_ORIGIN}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 8px 4px 0', color: '#6b6552' }}>TXT</td>
                    <td style={{ padding: '4px 8px' }}>{`_esoko-verify.${domain.hostname}`}</td>
                    <td style={{ padding: '4px 0', wordBreak: 'break-all' }}>{domain.verificationToken}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ margin: '10px 0 0', color: '#6b6552' }}>
                DNS changes can take up to a few hours to take effect. This page updates automatically once we see them.
              </p>
            </div>
          )}

          {domain.status === 'FAILED' && domain.failureReason && (
            <p style={{ fontSize: '.83rem', color: 'var(--stamp)', margin: '0 0 12px' }}>{domain.failureReason}</p>
          )}

          {domain.status === 'SUSPENDED' && (
            <p style={{ fontSize: '.83rem', color: 'var(--stamp)', margin: '0 0 12px' }}>
              Esoko support suspended this domain. Contact support to resolve it.
            </p>
          )}

          {domain.status !== 'SUSPENDED' && (
            <button className="btn btn-ghost" disabled={pending} onClick={remove}>
              Remove domain
            </button>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', margin: '10px 0 0' }}>{error}</p>}
    </div>
  );
}
