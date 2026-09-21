import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { ParcelOrgUnauthorised, getParcelOrgMe } from '@/lib/parcel-org-session';
import { getRunManifest } from '../../../../actions';
import { PrintButton } from './PrintButton';
import './manifest.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Run manifest — Esoqo',
  robots: { index: false, follow: false },
};

/**
 * The manifest: one run, every box on it, on a sheet that prints.
 *
 * This is the artifact the portal had no version of, and the one a
 * dispatcher is asked for most — a crew leaves with it, and the far end
 * checks boxes off against it on arrival. Until now a company's answer
 * to "what is on this lorry" was a screen somebody had to read aloud.
 *
 * Deliberately a page and not a dialog: it has a URL, so it can be
 * re-opened, re-printed, and sent to the phone of whoever is actually
 * standing at the tailgate. Ownership is proved server-side — a guessed
 * id 404s rather than revealing that it exists.
 */
export default async function RunManifestPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let me: Awaited<ReturnType<typeof getParcelOrgMe>>;
  try {
    me = await getParcelOrgMe();
  } catch (e) {
    if (e instanceof ParcelOrgUnauthorised) redirect('/parcel-org/signed-out');
    throw e;
  }

  const res = await getRunManifest(id);
  if (!res.ok) {
    return (
      <div className="head">
        <div>
          <h1>Manifest</h1>
          <p>{res.error}</p>
          <Link className="btn btn-o btn-sm" href="/parcel-org/dispatch">
            <Icon name="arrow-left" size={15} />Back to Dispatch
          </Link>
        </div>
      </div>
    );
  }

  const { shipment, items } = res;

  return (
    <div className="manifest">
      {/* Screen-only chrome. Everything below the sheet boundary is what
          comes out of the printer, which is why the back link and the
          print button live up here and carry .noprint. */}
      <div className="manifest-bar noprint">
        <Link className="btn btn-o btn-sm" href="/parcel-org/dispatch">
          <Icon name="arrow-left" size={15} />Dispatch
        </Link>
        <PrintButton />
      </div>

      <article className="manifest-sheet">
        <header className="manifest-head">
          <div>
            <p className="manifest-org">{me.org.name}</p>
            <h1>Loading manifest</h1>
          </div>
          <div className="manifest-meta">
            <span className="mono manifest-plate">{shipment.vehiclePlate || 'No plate'}</span>
            <span className={`pill ${shipment.status === 'LOADING' ? 'p-warn' : shipment.status === 'DEPARTED' ? 'p-ok' : 'p-info'}`}>
              {shipment.status === 'LOADING' ? 'Still loading' : shipment.status === 'DEPARTED' ? 'On the road' : shipment.status.toLowerCase()}
            </span>
          </div>
        </header>

        <dl className="manifest-facts">
          <div>
            <dt>Leg</dt>
            <dd>{shipment.originLabel} → {shipment.destinationLabel}</dd>
          </div>
          {shipment.routeLabel && (
            <div>
              <dt>Route</dt>
              <dd>{shipment.routeLabel}</dd>
            </div>
          )}
          <div>
            <dt>Parcels</dt>
            <dd className="mono">{items.length}</dd>
          </div>
          <div>
            <dt>Run opened</dt>
            <dd>{new Date(shipment.createdAt).toLocaleString('en-KE')}</dd>
          </div>
        </dl>

        {items.length === 0 ? (
          <p className="manifest-empty">
            {shipment.status === 'LOADING'
              ? 'Nothing loaded onto this run yet. Scan parcels onto it from the Scanner, then print this sheet.'
              : 'Nothing was loaded onto this run before it closed. Its manifest stays empty as the record.'}
          </p>
        ) : (
          <table className="manifest-table">
            <thead>
              <tr>
                <th className="manifest-n">#</th>
                <th>Parcel</th>
                <th>Receiver</th>
                <th>Going to</th>
                {/* The column that makes this a working document rather
                    than a report: the receiving clerk ticks each box. */}
                <th className="manifest-tick">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.code}>
                  <td className="manifest-n mono">{i + 1}</td>
                  <td>
                    <span className="mono manifest-code">{item.code}</span>
                    {item.externalRef && (
                      <span className="manifest-sub">Their #: {item.externalRef}</span>
                    )}
                    {item.parcelType && (
                      <span className="manifest-sub">{item.parcelType}</span>
                    )}
                  </td>
                  <td>
                    {item.receiverName || '—'}
                    {item.receiverMsisdn && (
                      <span className="manifest-sub mono">{item.receiverMsisdn}</span>
                    )}
                  </td>
                  <td>{item.destinationLabel || shipment.destinationLabel}</td>
                  <td className="manifest-tick" aria-hidden="true" />
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Signatures: the point of printing it. Two hands touch this
            run — the crew that takes it and the team that receives it. */}
        <div className="manifest-sign">
          <div><span>Loaded by</span><i /></div>
          <div><span>Driver / crew</span><i /></div>
          <div><span>Received by</span><i /></div>
        </div>
      </article>
    </div>
  );
}
