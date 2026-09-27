'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CameraScanner, Icon, type IconName } from '@esoqo/ui';

import { actionResolveScan, type ScanResolution } from './actions';

/**
 * The guest universal scanner.
 *
 * One code in, one destination out — the web counterpart of the mobile
 * app's UniversalScanScreen, and it makes the same split that screen
 * does: kinds with a real page of their own are navigated to, kinds
 * that are a single fact are rendered as a card in place. A round trip
 * to a page that shows four fields and a back button is worse than the
 * four fields.
 *
 * The routing table lives here, but the *decision* does not: core-go's
 * resolver says what a code is, and this never sniffs a prefix. That
 * boundary is the reason a new code type becomes a server change plus
 * one case here, rather than a parser in every client.
 *
 * Two inputs, camera and keyboard, because the camera is not always
 * the answer: a scratched label, a code read out over the phone, and
 * a desktop browser with no camera are all ordinary.
 */

const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'http://localhost:3003';

const PREFIX_EXAMPLES: ReadonlyArray<{ prefix: string; label: string; example: string }> = [
  { prefix: 'PKG-', label: 'Parcel', example: 'PKG-T7HZ967' },
  { prefix: 'TKT-', label: 'Ticket', example: 'TKT-8K2PQ4' },
  { prefix: 'PKP-', label: 'Pickup', example: 'PKP-4D9W2A' },
  { prefix: 'ESK-', label: 'Payment', example: 'ESK-9Q3M7X' },
];

const HISTORY_KEY = 'esoqo-scan-history';
const HISTORY_MAX = 5;

type Mode = 'scan' | 'type';

export function ScanClient() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('scan');
  const [typed, setTyped] = useState('');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory((JSON.parse(raw) as string[]).slice(0, HISTORY_MAX));
    } catch { /* private mode — history is a nicety, not a need */ }
  }, []);

  const pushHistory = useCallback((code: string) => {
    setHistory((prev) => {
      const next = [code, ...prev.filter((c) => c !== code)].slice(0, HISTORY_MAX);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resolve = useCallback(
    // The scanned value is passed explicitly rather than read from
    // state: the camera fires its callback in the same tick it decodes,
    // and reading `typed` there would resolve whatever was last typed.
    // Same race TrackParcelForm's own `override` argument avoids.
    (raw: string) => {
      const code = raw.trim().toUpperCase();
      if (!code) return;
      setLastCode(code);
      setTyped(code);
      setResult(null);
      startTransition(async () => {
        const res = await actionResolveScan(code);
        pushHistory(code);
        // A parcel is the one kind with a full page of its own on this
        // site — status, map, timeline, and the receiver-authentication
        // panel. Navigating beats rebuilding any of that here.
        if (res.kind === 'parcel' && res.parcel?.code) {
          router.push(`/t/${encodeURIComponent(res.parcel.code)}`);
          return;
        }
        // Certificates already have a verification page that talks to
        // the DAL directly (see verify/actions.ts). Send them there
        // rather than rendering a second, subtly different verdict.
        if (res.kind === 'certificate') {
          router.push(`/verify?code=${encodeURIComponent(code)}`);
          return;
        }
        setResult(res);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      });
    },
    [router, pushHistory],
  );

  const clearAll = useCallback(() => {
    setTyped('');
    setLastCode(null);
    setResult(null);
  }, []);

  const canGo = typed.trim().length > 0 && !pending;

  return (
    <div>
      {/* Mode switch — camera first on a phone at a counter, keyboard
          one tap away for a scratched label or a desktop with no camera. */}
      <div role="tablist" aria-label="How to enter the code" style={tabListStyle}>
        {(['scan', 'type'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => setMode(m)}
            style={mode === m ? tabActiveStyle : tabStyle}
          >
            <Icon name={m === 'scan' ? 'qr' : 'keypad'} size={16} />
            {m === 'scan' ? 'Scan' : 'Type a code'}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 22, boxShadow: 'var(--sh-m)', marginTop: 12 }}>
        {mode === 'scan' ? (
          <div>
            <CameraScanner onScan={resolve} hint="Hold the QR or barcode inside the frame — it reads automatically." />
            <Divider label="or type it" />
            <button type="button" className="btn btn-o btn-block" onClick={() => setMode('type')}>
              <Icon name="keypad" size={16} />Type the code instead
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); resolve(typed); }}
          >
            <label htmlFor="scan-code" style={labelStyle}>
              Esoqo code
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="scan-code"
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
                placeholder="PKG-T7HZ967"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={32}
                aria-describedby="scan-hint"
                className="mono"
                style={inputStyle}
              />
              {typed && (
                <button
                  type="button"
                  className="btn btn-o"
                  aria-label="Clear code"
                  onClick={clearAll}
                  style={{ padding: '0 14px', flex: 'none' }}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
              <button type="submit" className="btn btn-p" disabled={!canGo} style={{ flex: 'none', padding: '0 22px' }}>
                {pending ? <span className="spin" aria-hidden /> : <Icon name="arrow-right" size={16} />}
                {pending ? 'Checking…' : 'Go'}
              </button>
            </div>
            <p id="scan-hint" className="sub" style={{ margin: '8px 0 0', fontSize: '.85rem' }}>
              Parcel labels, tickets, pickup codes and payment IDs —{' '}
              <span className="mono">PKG- · TKT- · PKP- · ESK- · BUS-</span>
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {PREFIX_EXAMPLES.map((p) => (
                <button
                  key={p.prefix}
                  type="button"
                  className="chip"
                  title={`Try ${p.example}`}
                  onClick={() => { setTyped(p.example); resolve(p.example); }}
                >
                  <span className="mono" style={{ fontWeight: 700 }}>{p.prefix}</span>{p.label}
                </button>
              ))}
            </div>

            <Divider label="or scan it" />
            <button type="button" className="btn btn-o btn-block" onClick={() => setMode('scan')}>
              <Icon name="qr" size={16} />Back to camera
            </button>
          </form>
        )}

        <div aria-live="polite" ref={resultRef}>
          {pending && <LoadingCard code={lastCode} />}
          {result && !pending && lastCode && (
            <ResultCard result={result} code={lastCode} onReset={clearAll} onRetry={() => resolve(lastCode)} />
          )}
        </div>
      </div>

      {history.length > 0 && !pending && (
        <div className="card" style={{ marginTop: 14, padding: '16px 18px' }}>
          <p className="sub" style={{ margin: '0 0 10px', fontSize: '.78rem', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Recent on this device
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {history.map((h) => (
              <button key={h} type="button" className="chip mono" onClick={() => resolve(h)} title={`Look up ${h}`}>
                {h}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } }}
              style={{ background: 'none', border: 0, color: 'var(--tx-3)', fontSize: '.82rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Link href="/parcels/track" className="acard" style={{ padding: 18 }}>
          <span className="icbox icbox-g"><Icon name="package" size={20} /></span>
          <h3 style={{ fontSize: '.98rem' }}>Expecting a parcel?</h3>
          <p className="sub" style={{ margin: 0, fontSize: '.86rem' }}>Track it with live status, map and timeline.</p>
          <span className="go">Track a parcel <Icon name="arrow-right" size={14} /></span>
        </Link>
        <Link href="/verify" className="acard" style={{ padding: 18 }}>
          <span className="icbox icbox-b"><Icon name="shield-check" size={20} /></span>
          <h3 style={{ fontSize: '.98rem' }}>Holding a certificate?</h3>
          <p className="sub" style={{ margin: 0, fontSize: '.86rem' }}>Check who issued it and whether it is still valid.</p>
          <span className="go">Verify a certificate <Icon name="arrow-right" size={14} /></span>
        </Link>
      </div>

      <p className="sub" style={{ textAlign: 'center', marginTop: 18, fontSize: '.83rem' }}>
        <Icon name="lock" size={13} style={{ verticalAlign: -2 }} />{' '}
        Codes are looked up one at a time — nothing you scan leaves this page except the lookup itself.
      </p>
    </div>
  );
}

function LoadingCard({ code }: { code: string | null }) {
  return (
    <div className="skel-card" style={{ marginTop: 18 }} aria-label="Looking up code">
      <div className="skel-row">
        <div className="skel" style={{ width: 40, height: 40, borderRadius: 10 }} />
        <div style={{ flex: 1 }}>
          <div className="skel" style={{ height: 14, width: '55%' }} />
          <div className="skel" style={{ height: 12, width: '35%', marginTop: 8 }} />
        </div>
      </div>
      <div className="skel" style={{ height: 12 }} />
      <div className="skel" style={{ height: 12, width: '80%' }} />
      <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>
        Looking up{code ? <> <span className="mono">{code}</span></> : null}…
      </p>
    </div>
  );
}

function ResultCard({ result, code, onReset, onRetry }: {
  result: ScanResolution;
  code: string;
  onReset: () => void;
  onRetry: () => void;
}) {
  switch (result.kind) {
    case 'ticket': {
      const t = result.ticket;
      if (!t) break;
      const valid = t.status === 'VALID';
      return (
        <ResultShell
          icon="tag" title={t.eventName} pill={t.status}
          tone={valid ? 'good' : 'warn'} code={code} onReset={onReset}
        >
          <Row label="Class" value={t.className} />
          {t.seatLabel && <Row label="Seat" value={t.seatLabel} />}
          <Row label="Operator" value={t.orgName} />
          <Row label="Price" value={`KES ${t.priceKes}`} />
          <Row label="Ticket" value={t.code} mono />
          <p className="sub" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>
            Check-in happens at the gate — this page only confirms the ticket is real.
          </p>
        </ResultShell>
      );
    }
    case 'order': {
      const o = result.order;
      if (!o) break;
      const ready = o.status === 'READY_FOR_PICKUP';
      return (
        <ResultShell
          icon="basket" title={o.storeName} pill={ready ? 'Ready for pickup' : o.status}
          tone={ready ? 'good' : 'warn'} code={code} onReset={onReset}
        >
          <Row label="Pickup code" value={o.pickupCode} mono />
          <Row label="Total" value={`KES ${o.totalKes}`} />
          {o.readyAt && <Row label="Ready since" value={new Date(o.readyAt).toLocaleString()} />}
          {ready && (
            <p className="sub" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>
              Show this pickup code at the counter.
            </p>
          )}
        </ResultShell>
      );
    }
    case 'party': {
      const p = result.party;
      if (!p) break;
      return (
        <ResultShell
          icon="user" title={p.displayName}
          pill={p.verified ? 'Verified on Esoqo' : undefined}
          tone="good" code={code} onReset={onReset}
        >
          <Row label="Esoqo ID" value={p.esoqoId} mono />
          <p className="sub" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>
            {p.organisation ? 'A business on Esoqo.' : 'Pay this person from the Esoqo app.'}
          </p>
          {p.organisation && (
            // A business stand is the one thing scanned on this page
            // that the customer wants to *do* something with, so it
            // gets a way in. The usual case never reaches here — a
            // camera pointed at the business's printed QR opens
            // /pay directly — but someone scanning the plain text code
            // in the app should not have to go and retype it.
            <Link
              className="btn btn-p btn-block"
              style={{ marginTop: 14 }}
              href={`/pay?to=${encodeURIComponent(p.esoqoId)}`}
            >
              <Icon name="coins" size={16} />
              Pay this business
            </Link>
          )}
        </ResultShell>
      );
    }
    case 'fare': {
      const f = result.fare;
      if (!f) break;
      return (
        <ResultShell
          icon="check-circle" title="Fare receipt" pill={f.status}
          tone={f.status === 'VALID' ? 'good' : 'warn'} code={code} onReset={onReset}
        >
          <Row label="Amount" value={`KES ${f.amountKes}`} />
          {f.vehiclePlate && <Row label="Vehicle" value={f.vehiclePlate} />}
          {f.routeName && <Row label="Route" value={f.routeName} />}
          <Row label="Operator" value={f.orgName} />
          <Row label="Paid" value={`${f.ageMinutes} min ago`} />
        </ResultShell>
      );
    }
    case 'store':
    case 'table': {
      // The public storefront lives in the store app, not here. A link
      // out rather than a second menu implementation: there is exactly
      // one place that knows how to render a shop, and a table code is
      // that same shop with a table attached.
      const slug = result.table?.storeSlug ?? result.store?.slug;
      const name = result.table?.storeName ?? result.store?.name;
      if (!slug || !name) break;
      const table = result.table?.tableLabel;
      return (
        <ResultShell
          icon="shop" title={name}
          pill={table ? `Table ${table}` : 'Shop on Esoqo'}
          tone="good" code={code} onReset={onReset}
        >
          <p style={{ margin: '0 0 12px' }}>
            {table
              ? 'Open the menu and order — your table rides along with the order.'
              : 'Browse this shop on Esoqo.'}
          </p>
          <a className="btn btn-p btn-block" href={`${STORE_URL}/s/${encodeURIComponent(slug)}`} rel="noreferrer">
            {table ? 'Open the menu' : 'Open the shop'} <Icon name="arrow-right" size={15} />
          </a>
        </ResultShell>
      );
    }
    case 'product': {
      const p = result.product;
      if (!p) break;
      return (
        <ResultShell icon="tag" title={p.name} tone="good" code={code} onReset={onReset}>
          <Row label="Price" value={`KES ${p.priceKes}`} />
          <Row label="Shop" value={p.storeName} />
          <a
            className="btn btn-o btn-block"
            href={`${STORE_URL}/s/${encodeURIComponent(p.storeSlug)}`}
            rel="noreferrer"
            style={{ marginTop: 12 }}
          >
            Open the shop <Icon name="arrow-right" size={15} />
          </a>
        </ResultShell>
      );
    }
    case 'luggage': {
      const l = result.luggage;
      if (!l) break;
      return (
        <ResultShell
          icon="box" title={`Bag ${l.pieceNo} of ${l.pieceCount}`} pill={l.status}
          tone="good" code={code} onReset={onReset}
        >
          <Row label="Passenger" value={l.passengerInitial} />
          <Row label="Going to" value={l.destinationLabel} />
          <Row label="Tag" value={l.code} mono />
        </ResultShell>
      );
    }
    case 'trip':
    case 'voucher':
      // Both are app-only journeys: a trip code opens fare payment and a
      // voucher opens a wallet, neither of which this site has. Saying
      // what the code IS still beats "not an Esoqo code", which would be
      // a lie about a perfectly valid one.
      return (
        <ResultShell
          icon="phone" title={result.kind === 'trip' ? 'A bus fare code' : 'An Esoqo voucher'}
          tone="warn" code={code} onReset={onReset}
        >
          <p style={{ margin: '0 0 12px' }}>
            {result.kind === 'trip'
              ? 'Scan this with the Esoqo app to pay your fare.'
              : 'Open this voucher in the Esoqo app wallet.'}
          </p>
          <div className="row">
            <button type="button" className="btn btn-o btn-sm" onClick={onRetry}>
              <Icon name="refresh" size={14} />Scan another
            </button>
          </div>
        </ResultShell>
      );
  }

  return (
    <ResultShell icon="alert-circle" title="Not an Esoqo code" tone="warn" code={code} onReset={onReset}>
      <p style={{ margin: '0 0 12px' }}>
        Nothing on Esoqo matches that. Check for a mistyped character — <span className="mono">0/O</span> and{' '}
        <span className="mono">1/I</span> are the usual suspects.
      </p>
      <div className="row">
        <button type="button" className="btn btn-o btn-sm" onClick={onRetry}>
          <Icon name="refresh" size={14} />Try again
        </button>
        <Link href="/parcels/track" className="btn btn-p btn-sm">
          Track a parcel <Icon name="arrow-right" size={14} />
        </Link>
      </div>
    </ResultShell>
  );
}

function ResultShell({
  icon, title, pill, tone = 'good', code, onReset, children,
}: {
  icon: IconName;
  title: string;
  pill?: string;
  tone?: 'good' | 'warn';
  code: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const good = tone === 'good';
  return (
    <div style={{ marginTop: 18, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }} role="status">
      <div style={{
        background: good ? 'var(--green)' : 'var(--amber)',
        color: '#fff', padding: '16px 18px',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{
          width: 40, height: 40, borderRadius: 10, flex: 'none',
          background: 'rgba(255,255,255,.2)', display: 'grid', placeItems: 'center',
        }}>
          <Icon name={icon} size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
          <span className="mono" style={{ fontSize: '.78rem', opacity: .9 }}>{code}</span>
        </div>
        {pill && (
          <span className="pill" style={{ background: 'rgba(255,255,255,.2)', color: '#fff', fontSize: '.74rem' }}>
            {pill}
          </span>
        )}
      </div>
      <div style={{ padding: '16px 18px' }}>
        {children}
        <button
          type="button"
          onClick={onReset}
          style={{ background: 'none', border: 0, color: 'var(--tx-3)', fontSize: '.84rem', cursor: 'pointer', padding: '12px 0 0', textDecoration: 'underline' }}
        >
          Scan another code
        </button>
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div style={dividerStyle} aria-hidden>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      {label}
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="sub" style={{ fontSize: '.88rem' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ textAlign: 'right', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const tabListStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
  background: 'var(--paper)', border: '1px solid var(--line)',
  borderRadius: 12, padding: 4,
};

const tabBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: 0, borderRadius: 8, padding: '11px 12px', minHeight: 46,
  fontSize: '.92rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const tabStyle: React.CSSProperties = { ...tabBase, background: 'transparent', color: 'var(--tx-2)' };
const tabActiveStyle: React.CSSProperties = {
  ...tabBase, background: '#fff', color: 'var(--navy)', boxShadow: 'var(--sh-s)',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '.88rem', marginBottom: 6, color: 'var(--tx)',
};

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '12px 14px', minHeight: 50,
  border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.05rem',
  letterSpacing: '.06em', textTransform: 'uppercase', background: 'var(--paper)',
};

const dividerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0',
  color: 'var(--tx-3)', fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.1em',
};
