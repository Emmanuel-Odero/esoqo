'use client';

import { Icon } from '@esoqo/ui';
import type { TripManifestRow } from '../../../actions';

/**
 * The run sheet a driver signs for.
 *
 * Deliberately paper. Not because the app is untrusted, but because a
 * signature survives a dispute six weeks later when the phone that
 * recorded everything has been replaced, the rider has moved on, and
 * the only question left is whether a particular box was ever put in a
 * particular vehicle.
 *
 * Ordered by drop stage, the way GetTripManifest returns it — a
 * conductor reads this standing in a moving vehicle, so the next stop's
 * parcels belong at the top. Sorting by booking time would be an order
 * that means nothing to anyone holding it.
 *
 * Phone numbers are on here, unlike the label that rides on the box.
 * That is the difference between a document handed to a named person
 * who signed for it and a sticker anyone can read off a parcel — this
 * sheet is custody, so it carries what custody needs.
 */
export function ManifestSheet({
  tripId, parcels,
}: { tripId: string; parcels: TripManifestRow[] }) {
  const codTotal = parcels.reduce((sum, p) => sum + (Number(p.codAmountKes) || 0), 0);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }} className="no-print">
        <button className="btn btn-p btn-sm" onClick={() => window.print()}>
          <Icon name="print" size={13} />Print run sheet
        </button>
      </div>

      <div className="manifest-sheet card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <strong style={{ fontSize: '1.15rem' }}>Run sheet</strong>
            <p className="sub mono" style={{ margin: '2px 0 0', fontSize: '.8rem' }}>Trip {tripId}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="sub" style={{ margin: 0, fontSize: '.8rem' }}>
              Printed {new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <p style={{ margin: '2px 0 0', fontWeight: 700 }}>
              {parcels.length} parcel{parcels.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {parcels.length === 0 ? (
          <p className="sub">Nothing is loaded on this trip.</p>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Code</th><th>Drop</th><th>Receiver</th><th>Phone</th>
                  <th className="num">Collect</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((p) => (
                  <tr key={p.code}>
                    {/* A physical tick box. The sheet is worked through
                        by hand as boxes come off, and a printed row with
                        nowhere to mark it gets marked in the margin. */}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', width: 13, height: 13, border: '1.5px solid #666', borderRadius: 2 }} />
                    </td>
                    <td className="mono">{p.code}</td>
                    <td>
                      {p.dropStageName ?? p.destinationLabel}
                      {p.dropStageOrder != null && (
                        <span className="sub" style={{ display: 'block', fontSize: '.75rem' }}>
                          stop {p.dropStageOrder}
                        </span>
                      )}
                    </td>
                    <td>{p.receiverName}</td>
                    <td className="mono" style={{ fontSize: '.82rem' }}>{p.receiverMsisdn}</td>
                    <td className="num mono">
                      {p.codAmountKes && Number(p.codAmountKes) > 0
                        ? `KES ${Number(p.codAmountKes).toLocaleString('en-KE')}`
                        : <span className="sub">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* The figure the driver is accountable for before they
                leave. Totalled here rather than left to be added up in
                the depot, because the whole point of signing is that
                both sides agreed on a number. */}
            {codTotal > 0 && (
              <p style={{ marginTop: 12, fontWeight: 700, textAlign: 'right' }}>
                Cash to collect: KES {codTotal.toLocaleString('en-KE')}
              </p>
            )}
          </>
        )}

        <div style={{ marginTop: 32, display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          <Signature label="Driver — name and signature" />
          <Signature label="Dispatcher — name and signature" />
        </div>
      </div>

      <PrintStyles />
    </>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ borderBottom: '1px solid #333', height: 34 }} />
      <p className="sub" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>{label}</p>
    </div>
  );
}

/** Same "hide everything but the sheet" approach the label printer
 *  uses — no popup window to fight a blocker over, and it inherits the
 *  page's fonts for free. Landscape because this table is wide and a
 *  portrait sheet wraps the phone column onto a second line. */
function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        @page { size: landscape; margin: 12mm; }
        body * { visibility: hidden; }
        .manifest-sheet, .manifest-sheet * { visibility: visible; }
        .manifest-sheet { position: absolute; top: 0; left: 0; width: 100%; border: 0; padding: 0 !important; }
        .no-print { display: none; }
        .tbl tr { break-inside: avoid; page-break-inside: avoid; }
      }
    `}</style>
  );
}
