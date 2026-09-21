'use client';

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';

import { CodeScanner } from '@/components/CodeScanner';
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

export function ScanClient() {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [pending, startTransition] = useTransition();

  const resolve = useCallback(
    // The scanned value is passed explicitly rather than read from
    // state: the camera fires its callback in the same tick it decodes,
    // and reading `typed` there would resolve whatever was last typed.
    // Same race TrackParcelForm's own `override` argument avoids.
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setResult(null);
      startTransition(async () => {
        const res = await actionResolveScan(code);
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
      });
    },
    [router],
  );

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); resolve(typed); }}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
      >
        <label htmlFor="scan-code" className="vh">Esoqo code</label>
        <input
          id="scan-code"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="PKG-T7HZ967"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" className="btn btn-p" disabled={pending || !typed.trim()}>
          {pending ? 'Checking…' : 'Go'}
        </button>
      </form>

      <p className="sub" style={{ margin: '8px 0 14px', fontSize: '.85rem' }}>
        Parcel labels, tickets, pickup codes and payment IDs —{' '}
        <span className="mono">PKG- · TKT- · PKP- · ESK- · BUS-</span>
      </p>

      {/* CodeScanner keeps its own open/closed state and only pulls in
          html5-qrcode once the camera is actually opened, so mounting it
          unconditionally costs nothing until somebody taps Scan. */}
      <CodeScanner onScan={resolve} hint="Point your camera at any Esoqo QR or barcode." />

      {pending && <p className="sub" style={{ marginTop: 16 }}>Looking that up…</p>}
      {result && !pending && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: ScanResolution }) {
  switch (result.kind) {
    case 'ticket': {
      const t = result.ticket;
      if (!t) break;
      return (
        <Card icon="tag" title={t.eventName} pill={t.status} tone={t.status === 'VALID' ? 'good' : 'warn'}>
          <Row label="Class" value={t.className} />
          {t.seatLabel && <Row label="Seat" value={t.seatLabel} />}
          <Row label="Operator" value={t.orgName} />
          <Row label="Price" value={`KES ${t.priceKes}`} />
          <Row label="Ticket" value={t.code} mono />
          <p className="sub" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>
            Check-in happens at the gate — this page only confirms the ticket is real.
          </p>
        </Card>
      );
    }
    case 'order': {
      const o = result.order;
      if (!o) break;
      const ready = o.status === 'READY_FOR_PICKUP';
      return (
        <Card icon="basket" title={o.storeName} pill={ready ? 'Ready' : o.status} tone={ready ? 'good' : 'warn'}>
          <Row label="Pickup code" value={o.pickupCode} mono />
          <Row label="Total" value={`KES ${o.totalKes}`} />
          {o.readyAt && <Row label="Ready since" value={new Date(o.readyAt).toLocaleString()} />}
        </Card>
      );
    }
    case 'party': {
      const p = result.party;
      if (!p) break;
      return (
        <Card icon="user" title={p.displayName} pill={p.verified ? 'Verified on Esoqo' : undefined} tone="good">
          <Row label="Esoqo ID" value={p.esoqoId} mono />
          <p className="sub" style={{ margin: '10px 0 0', fontSize: '.85rem' }}>
            {p.organisation ? 'A business on Esoqo.' : 'Pay this person from the Esoqo app.'}
          </p>
        </Card>
      );
    }
    case 'fare': {
      const f = result.fare;
      if (!f) break;
      return (
        <Card icon="check-circle" title="Fare receipt" pill={f.status} tone={f.status === 'VALID' ? 'good' : 'warn'}>
          <Row label="Amount" value={`KES ${f.amountKes}`} />
          {f.vehiclePlate && <Row label="Vehicle" value={f.vehiclePlate} />}
          {f.routeName && <Row label="Route" value={f.routeName} />}
          <Row label="Operator" value={f.orgName} />
          <Row label="Paid" value={`${f.ageMinutes} min ago`} />
        </Card>
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
        <Card icon="shop" title={name} pill={table ? `Table ${table}` : undefined} tone="good">
          <p style={{ margin: '0 0 12px' }}>
            {table
              ? 'Open the menu and order — your table rides along with the order.'
              : 'Browse this shop on Esoqo.'}
          </p>
          <a className="btn btn-p" href={`${STORE_URL}/s/${encodeURIComponent(slug)}`} rel="noreferrer">
            {table ? 'Open the menu' : 'Open the shop'}
          </a>
        </Card>
      );
    }
    case 'product': {
      const p = result.product;
      if (!p) break;
      return (
        <Card icon="tag" title={p.name} tone="good">
          <Row label="Price" value={`KES ${p.priceKes}`} />
          <Row label="Shop" value={p.storeName} />
          <a
            className="btn btn-o btn-sm"
            href={`${STORE_URL}/s/${encodeURIComponent(p.storeSlug)}`}
            rel="noreferrer"
            style={{ marginTop: 12 }}
          >
            Open the shop
          </a>
        </Card>
      );
    }
    case 'luggage': {
      const l = result.luggage;
      if (!l) break;
      return (
        <Card icon="box" title={`Bag ${l.pieceNo} of ${l.pieceCount}`} pill={l.status} tone="good">
          <Row label="Passenger" value={l.passengerInitial} />
          <Row label="Going to" value={l.destinationLabel} />
          <Row label="Tag" value={l.code} mono />
        </Card>
      );
    }
    case 'trip':
    case 'voucher':
      // Both are app-only journeys: a trip code opens fare payment and a
      // voucher opens a wallet, neither of which this site has. Saying
      // what the code IS still beats "not an Esoqo code", which would be
      // a lie about a perfectly valid one.
      return (
        <Card icon="phone" title={result.kind === 'trip' ? 'A bus fare code' : 'An Esoqo voucher'} tone="warn">
          <p style={{ margin: 0 }}>
            {result.kind === 'trip'
              ? 'Scan this with the Esoqo app to pay your fare.'
              : 'Open this voucher in the Esoqo app wallet.'}
          </p>
        </Card>
      );
  }

  return (
    <Card icon="alert-circle" title="Not an Esoqo code" tone="warn">
      <p style={{ margin: 0 }}>
        Nothing on Esoqo matches that. Check for a mistyped character, or{' '}
        <Link href="/parcels/track">track a parcel by its code</Link>.
      </p>
    </Card>
  );
}

function Card({
  icon, title, pill, tone = 'good', children,
}: {
  icon: IconName;
  title: string;
  pill?: string;
  tone?: 'good' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Icon name={icon} size={20} />
        <strong style={{ flex: 1, minWidth: 0 }}>{title}</strong>
        {pill && (
          <span
            className="pill"
            style={{
              fontSize: '.78rem',
              color: tone === 'good' ? 'var(--green, #0a7d3f)' : 'var(--amber, #9a6700)',
            }}
          >
            {pill}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span className="sub" style={{ fontSize: '.88rem' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
