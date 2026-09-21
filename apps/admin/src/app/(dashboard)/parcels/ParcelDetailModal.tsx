'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon, type IconName } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionAssignParcelCollector, actionSearchCollectors, actionCancelParcel, actionMarkParcelRefunded,
  actionGetParcelHandoffs, actionFlagParcelException, actionClearParcelException, actionUpdateParcelDetails,
  actionConfirmParcelIntake,
  actionGrantReceiverAuthRetry, actionReissueDeliveryCode, actionReleaseHeldCourierEarnings,
  type CollectorLite, type HandoffRow,
} from './actions';
import type { AdminParcelRow } from './ParcelsTable';
import { ParcelLabelPrint } from './ParcelLabelPrint';

const CANCELLABLE = new Set(['DRAFT_PENDING_PAYMENT', 'BOOKED', 'RECEIVED_AT_COUNTER']);
const FLAGGABLE = new Set(['RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT']);
const EDITABLE = new Set(['DRAFT_PENDING_PAYMENT', 'BOOKED', 'RECEIVED_AT_COUNTER']);
// A label only means anything once there's a price/route locked in —
// same "not while it's still a draft" rule EDITABLE's inverse would
// suggest, but expressed as "everything past DRAFT" rather than
// enumerating every later status.
const LABELABLE = new Set(['BOOKED', 'RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']);

type Panel = 'edit' | 'assign' | 'cancel' | 'flag' | 'label' | null;

/**
 * Everything the old wide table tried to show in columns, plus every
 * CRUD action a parcel supports, in one place:
 *  - Read: every field below (contact, route, price/payment/receipt,
 *    custody, SLA, receiver's own receipt confirmation, handling
 *    history — fetched fresh on open since it's the one thing not
 *    already in the list row).
 *  - Update: correct receiver/destination/notes (pre-pickup only),
 *    schedule/reschedule a collector, mark an M-Pesa refund processed.
 *  - Create-ish: flag an exception.
 *  - Delete-ish: cancel the parcel, clear a resolved exception.
 */
export function ParcelDetailModal({
  parcel, statusLabel, canAssign, canCancel, canRefund, canEdit, onClose,
}: {
  parcel: AdminParcelRow; statusLabel: Record<string, string>;
  canAssign: boolean; canCancel: boolean; canRefund: boolean; canEdit: boolean;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [handoffs, setHandoffs] = useState<HandoffRow[] | null>(null);
  const [handoffsLoading, setHandoffsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    actionGetParcelHandoffs(parcel.ID).then((h) => { if (!cancelled) { setHandoffs(h); setHandoffsLoading(false); } });
    return () => { cancelled = true; };
  }, [parcel.ID]);

  const canManage = canAssign || canCancel || canRefund || canEdit;

  return (
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pd-title">
        <div className="modal-hd">
          <div>
            <h2 id="pd-title" className="mono">{parcel.Code}</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              <span className={`pill ${parcel.Status === 'DRAFT_PENDING_PAYMENT' ? 'p-warn' : parcel.Status === 'CANCELLED' ? 'p-bad' : parcel.Status === 'DELIVERED' ? 'p-ok' : 'p-info'}`}>
                {statusLabel[parcel.Status] ?? parcel.Status}
              </span>
              {' '}· Booked {new Date(parcel.CreatedAt).toLocaleString('en-KE')}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          <DetailSections parcel={parcel} handoffs={handoffs} handoffsLoading={handoffsLoading} />

          {LABELABLE.has(parcel.Status) && (
            <div style={{ margin: '18px 0 0' }}>
              <button className="btn btn-o btn-sm" onClick={() => setPanel(panel === 'label' ? null : 'label')}>
                <Icon name="qr" size={13} />{panel === 'label' ? 'Hide label' : 'Print label'}
              </button>
              {panel === 'label' && (
                <div style={{ marginTop: 10 }}>
                  <ParcelLabelPrint code={parcel.Code} onClose={() => setPanel(null)} />
                </div>
              )}
            </div>
          )}

          {canManage && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0' }}>
                {canAssign && parcel.Status === 'BOOKED' && !parcel.IntakeConfirmedAt && (
                  <ConfirmIntakeButton code={parcel.Code} />
                )}
                {canEdit && EDITABLE.has(parcel.Status) && (
                  <button className="btn btn-o btn-sm" onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>
                    Edit details
                  </button>
                )}
                {canAssign && (parcel.Status === 'BOOKED' || parcel.Status === 'RECEIVED_AT_COUNTER') && (
                  <button className="btn btn-o btn-sm" onClick={() => setPanel(panel === 'assign' ? null : 'assign')}>
                    <Icon name="truck" size={13} />{parcel.AssignedCollectorName ? 'Reschedule collection' : 'Schedule collection'}
                  </button>
                )}
                {canRefund && parcel.RefundStatus === 'PENDING' && <RefundButton parcelId={parcel.ID} />}
                {canCancel && !parcel.ExceptionNote && FLAGGABLE.has(parcel.Status) && (
                  <button className="btn btn-o btn-sm" style={{ color: 'var(--amber)' }} onClick={() => setPanel(panel === 'flag' ? null : 'flag')}>
                    <Icon name="alert-triangle" size={13} />Flag exception
                  </button>
                )}
                {canCancel && parcel.ExceptionNote && <ClearExceptionButton parcelId={parcel.ID} />}
                {/* Escalating, and only the step the parcel is at:
                    offering "new code" beside "two more tries" invites
                    an operator to reissue on a receiver who merely
                    mistyped a digit, which burns two SMS and kills a
                    code they may be about to get right. */}
                {canAssign && parcel.ReceiverAuthLockedAt && !parcel.ReceiverAuthHardLockedAt && (
                  <ReceiverAuthButton
                    parcelId={parcel.ID} label="Allow two more tries" icon="refresh"
                    done="Two more tries allowed" action={actionGrantReceiverAuthRetry}
                  />
                )}
                {canCancel && (parcel.ReceiverAuthLockedAt || parcel.ReceiverAuthHardLockedAt) && (
                  <ReceiverAuthButton
                    parcelId={parcel.ID} label="Issue a new delivery code" icon="key"
                    done="New delivery code texted to the sender and receiver"
                    action={actionReissueDeliveryCode}
                  />
                )}
                {canCancel && parcel.CourierEarningsHeldUntil && (
                  <ReceiverAuthButton
                    parcelId={parcel.ID} label="Release courier pay" icon="coins"
                    done="Courier earnings released" action={actionReleaseHeldCourierEarnings}
                  />
                )}
                {canCancel && CANCELLABLE.has(parcel.Status) && (
                  <button className="btn btn-o btn-sm" style={{ color: 'var(--red)' }} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
                    <Icon name="close" size={13} />Cancel parcel
                  </button>
                )}
              </div>

              {panel === 'edit' && <EditPanel parcel={parcel} onDone={onClose} />}
              {panel === 'assign' && <AssignPanel parcelId={parcel.ID} onDone={onClose} />}
              {panel === 'cancel' && <CancelPanel parcelId={parcel.ID} onDone={onClose} />}
              {panel === 'flag' && <FlagPanel parcelId={parcel.ID} onDone={onClose} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <tr><td className="sub" style={{ width: 150, verticalAlign: 'top' }}>{label}</td><td>{children}</td></tr>;
}

function DetailSections({
  parcel, handoffs, handoffsLoading,
}: { parcel: AdminParcelRow; handoffs: HandoffRow[] | null; handoffsLoading: boolean }) {
  const overdue = parcel.SlaDeadlineAt && FLAGGABLE.has(parcel.Status) && new Date(parcel.SlaDeadlineAt) < new Date();
  return (
    <table className="tbl">
      <tbody>
        <Row label="Sender">{parcel.SenderName} <span className="sub">· {parcel.SenderMsisdn}</span></Row>
        <Row label="Receiver">{parcel.ReceiverName} <span className="sub">· {parcel.ReceiverMsisdn}</span></Row>
        <Row label="Route">{parcel.OriginLabel} → {parcel.DestinationLabel}</Row>
        {parcel.Notes && <Row label="Notes">{parcel.Notes}</Row>}
        <Row label="Type">{parcel.ParcelType.replace(/_/g, ' ')}</Row>
        <Row label="Price">
          {parcel.PriceKes ? `KES ${Number(parcel.PriceKes).toLocaleString('en-KE')}` : '— (draft, unpriced)'}
        </Row>
        <Row label="Payment">
          {parcel.PaymentMethod ? parcel.PaymentMethod.replace(/_/g, ' ') : '— (not yet paid)'}
          {parcel.MpesaReceiptCode && <span className="mono sub" style={{ marginLeft: 8 }}>Ref {parcel.MpesaReceiptCode}</span>}
        </Row>
        {parcel.RefundStatus !== 'NOT_APPLICABLE' && (
          <Row label="Refund">
            <span className={`pill ${parcel.RefundStatus === 'PENDING' ? 'p-warn' : 'p-ok'}`}>
              {parcel.RefundStatus === 'PENDING' ? 'Owed' : 'Refunded'}
            </span>
            {parcel.RefundedAt && <span className="sub" style={{ marginLeft: 8 }}>{new Date(parcel.RefundedAt).toLocaleString('en-KE')}</span>}
          </Row>
        )}
        <Row label="Collector">
          {parcel.AssignedCollectorName ? (
            <>
              {parcel.AssignedCollectorName}{parcel.AssignedCollectorMsisdn && <span className="sub"> · {parcel.AssignedCollectorMsisdn}</span>}
              {parcel.CollectionScheduledAt && <span className="sub" style={{ display: 'block' }}>Scheduled {new Date(parcel.CollectionScheduledAt).toLocaleString('en-KE')}</span>}
              {parcel.CollectionNote && <span className="sub" style={{ display: 'block' }}>{parcel.CollectionNote}</span>}
            </>
          ) : 'Not yet assigned'}
        </Row>
        {parcel.SlaDeadlineAt && (
          <Row label="SLA deadline">
            {new Date(parcel.SlaDeadlineAt).toLocaleString('en-KE')}
            {overdue && <span className="pill p-bad" style={{ marginLeft: 8 }}>Overdue</span>}
          </Row>
        )}
        {parcel.ReceiptConfirmedAt && (
          <Row label="Receipt confirmed">
            {new Date(parcel.ReceiptConfirmedAt).toLocaleString('en-KE')}
            {parcel.ReceiptConditionRating && (
              <span style={{ marginLeft: 8 }}>{'★'.repeat(parcel.ReceiptConditionRating)}{'☆'.repeat(5 - parcel.ReceiptConditionRating)}</span>
            )}
            {parcel.ReceiptFeedback && <span className="sub" style={{ display: 'block' }}>&quot;{parcel.ReceiptFeedback}&quot;</span>}
          </Row>
        )}
        {parcel.ExceptionNote && (
          <Row label="Exception">
            <span className="pill p-bad" style={{ whiteSpace: 'normal' }}>
              <Icon name="alert-triangle" size={12} />{parcel.ExceptionNote}
            </span>
            {parcel.ExceptionFlaggedAt && <span className="sub" style={{ display: 'block' }}>Flagged {new Date(parcel.ExceptionFlaggedAt).toLocaleString('en-KE')}</span>}
          </Row>
        )}
        {/* The receiver's own side of the code. Distinct from delivery
            attempts below, which is a courier reaching a door and
            finding nobody: here the parcel is exactly where it should
            be and the person collecting it cannot prove who they are. */}
        {(parcel.ReceiverAuthAttempts > 0 || parcel.ReceiverAuthLockedAt
          || parcel.ReceiverAuthHardLockedAt || parcel.DeliveryCodeVersion > 1) && (
          <Row label="Receiver verification">
            <span className={`pill ${parcel.ReceiverAuthHardLockedAt ? 'p-bad' : parcel.ReceiverAuthLockedAt ? 'p-warn' : 'p-info'}`}>
              <Icon name="lock" size={12} />
              {parcel.ReceiverAuthHardLockedAt
                ? 'Hard locked — needs a new code'
                : parcel.ReceiverAuthLockedAt
                  ? 'Locked out'
                  : `${parcel.ReceiverAuthAttempts} wrong ${parcel.ReceiverAuthAttempts === 1 ? 'code' : 'codes'}`}
            </span>
            {(parcel.ReceiverAuthHardLockedAt ?? parcel.ReceiverAuthLockedAt) && (
              <span className="sub" style={{ display: 'block' }}>
                Since {new Date((parcel.ReceiverAuthHardLockedAt ?? parcel.ReceiverAuthLockedAt)!).toLocaleString('en-KE')}
                {' · '}{parcel.ReceiverAuthAttempts} wrong codes
              </span>
            )}
            {parcel.DeliveryCodeVersion > 1 && (
              <span className="sub" style={{ display: 'block' }}>
                Delivery code reissued {parcel.DeliveryCodeVersion - 1}×
              </span>
            )}
          </Row>
        )}
        {parcel.CourierEarningsHeldUntil && (
          <Row label="Courier pay held">
            <span className="pill p-warn">
              until {new Date(parcel.CourierEarningsHeldUntil).toLocaleString('en-KE')}
            </span>
            <span className="sub" style={{ display: 'block' }}>
              The receiver closed this themselves at a pickup point — no staff witness.
            </span>
          </Row>
        )}
        {parcel.Status === 'CANCELLED' && (
          <Row label="Cancelled">
            {parcel.CancellationReason}
            {parcel.CancelledAt && <span className="sub" style={{ display: 'block' }}>{new Date(parcel.CancelledAt).toLocaleString('en-KE')}</span>}
          </Row>
        )}
        {/* The failed-attempt record. An operator fielding a "where is
            my parcel" call can now answer it from here instead of
            phoning the courier — and can tell the difference between a
            rider who is stuck and a receiver who is never in. */}
        {parcel.DeliveryAttempts > 0 && (
          <Row label="Delivery attempts">
            <span className={`pill ${parcel.DeliveryAttempts >= 3 ? 'p-bad' : 'p-warn'}`}>
              {parcel.DeliveryAttempts} {parcel.DeliveryAttempts === 1 ? 'attempt' : 'attempts'}
            </span>
            {parcel.LastAttemptReason && (
              <span className="sub" style={{ display: 'block' }}>
                Last: {parcel.LastAttemptReason.replace(/_/g, ' ').toLowerCase()}
                {parcel.LastAttemptAt && ` · ${new Date(parcel.LastAttemptAt).toLocaleString('en-KE')}`}
              </span>
            )}
            {parcel.DeliveryAttempts >= 3 && (
              <span className="sub" style={{ display: 'block' }}>
                Three or more — call the receiver or return it to the sender.
              </span>
            )}
          </Row>
        )}
        {parcel.AgentName && (
          <Row label="At pickup point">
            {parcel.AgentName}
            {parcel.AgentLocationHint && <span className="sub"> · {parcel.AgentLocationHint}</span>}
            {parcel.AgentHeldSince && (
              <span className="sub" style={{ display: 'block' }}>
                Since {new Date(parcel.AgentHeldSince).toLocaleString('en-KE')}
              </span>
            )}
          </Row>
        )}
        {/* Who's carrying it, and how the money splits. Absent entirely
            for an Esoqo-operated parcel, where the whole price is
            already Esoqo's and a "split" would be a fiction. */}
        <Row label="Carried by">
          {parcel.ParcelOrgName ?? <span className="sub">Esoqo dispatch</span>}
          {parcel.OrgEarningsKes && (
            <span className="sub" style={{ display: 'block' }}>
              They earn KES {Number(parcel.OrgEarningsKes).toLocaleString('en-KE')}
              {parcel.PlatformFeeKes && ` · Esoqo keeps KES ${Number(parcel.PlatformFeeKes).toLocaleString('en-KE')}`}
            </span>
          )}
          {!parcel.OrgEarningsKes && parcel.ParcelOrgName && (
            <span className="sub" style={{ display: 'block' }}>
              Split is set when this parcel is paid for.
            </span>
          )}
        </Row>
        {parcel.DeclaredValueKes && (
          <Row label="Declared value">
            KES {Number(parcel.DeclaredValueKes).toLocaleString('en-KE')}
            {parcel.CoverageTierName
              ? <span className="sub"> · {parcel.CoverageTierName} cover</span>
              : <span className="sub"> · no cover bought</span>}
          </Row>
        )}
        {parcel.Status === 'DELIVERED' && parcel.DeliveredAt && (
          <Row label="Delivered">{new Date(parcel.DeliveredAt).toLocaleString('en-KE')}</Row>
        )}
        {/* Proof of delivery — the record that settles a dispute
            instead of leaving it to somebody's word. The photo is
            served through the API's own code-gated route, never a
            bucket URL: it's a picture of somebody's doorway. */}
        {(parcel.PodReceivedByName || parcel.PodPhotoUrl) && (
          <Row label="Proof of delivery">
            {parcel.PodReceivedByName && <>Received by <strong>{parcel.PodReceivedByName}</strong></>}
            {parcel.PodMethod && (
              <span className="sub" style={{ display: 'block' }}>
                {parcel.PodMethod === 'DELIVERY_CODE' && 'Confirmed with the delivery code'}
                {parcel.PodMethod === 'AGENT_COLLECTION' && 'Collected at a pickup point'}
                {parcel.PodMethod === 'STAFF_OVERRIDE' && 'Handed over without a code (staff override)'}
              </span>
            )}
            {parcel.PodPhotoUrl && (
              // A plain <img>, not next/image: the source is a proxied,
              // staff-gated, per-parcel route the image optimiser can
              // neither cache nor resize meaningfully, and routing a
              // delivery photo through a shared optimiser cache is
              // exactly the leak the proxy exists to prevent.
              <img
                src={`/api/parcel-pod/${encodeURIComponent(parcel.Code)}`}
                alt={`Parcel ${parcel.Code} at the point of hand-over`}
                style={{ display: 'block', marginTop: 8, maxWidth: 260, borderRadius: 8 }}
              />
            )}
          </Row>
        )}
        <Row label="Handling history">
          {handoffsLoading && 'Loading…'}
          {!handoffsLoading && (!handoffs || handoffs.length === 0) && "Nobody's scanned this parcel into custody yet."}
          {!handoffsLoading && handoffs && handoffs.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {handoffs.map((h, i) => (
                <li key={i} className="sub">{h.FromName ?? 'Sender'} → <strong>{h.ToName}</strong> — {new Date(h.CreatedAt).toLocaleString('en-KE')}</li>
              ))}
            </ol>
          )}
        </Row>
      </tbody>
    </table>
  );
}

function ActionError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
      <Icon name="alert-circle" size={14} />{error}
    </p>
  );
}

function EditPanel({ parcel, onDone }: { parcel: AdminParcelRow; onDone: () => void }) {
  const [receiverName, setReceiverName] = useState(parcel.ReceiverName);
  const [receiverMsisdn, setReceiverMsisdn] = useState(parcel.ReceiverMsisdn);
  const [destinationLabel, setDestinationLabel] = useState(parcel.DestinationLabel);
  const [notes, setNotes] = useState(parcel.Notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateParcelDetails(parcel.ID, {
        receiverName, receiverMsisdn, destinationLabel, notes: notes.trim() || undefined,
      });
      if (!result.ok) setError(result.error);
      else { announce('Parcel details updated', 'assertive'); onDone(); }
    });
  }

  return (
    <Panel title="Edit details">
      <p className="sub" style={{ margin: '0 0 10px' }}>
        Only possible before a courier picks it up — the sender/origin stay fixed since that's
        whoever booked and is paying for it.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="sub">Receiver name
          <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)}
            style={INPUT} />
        </label>
        <label className="sub">Receiver phone
          <input value={receiverMsisdn} onChange={(e) => setReceiverMsisdn(e.target.value)}
            style={INPUT} />
        </label>
      </div>
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Destination
        <input value={destinationLabel} onChange={(e) => setDestinationLabel(e.target.value)}
          style={{ ...INPUT, display: 'block', width: '100%' }} />
      </label>
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          style={{ ...INPUT, display: 'block', width: '100%' }} />
      </label>
      <button className="btn btn-p btn-sm" disabled={pending} onClick={submit}>{pending ? 'Saving…' : 'Save changes'}</button>
      <ActionError error={error} />
    </Panel>
  );
}

function AssignPanel({ parcelId, onDone }: { parcelId: string; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [collectors, setCollectors] = useState<CollectorLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CollectorLite | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    try { setCollectors(await actionSearchCollectors(q)); } finally { setSearching(false); }
  }

  function submit() {
    if (!selected || !scheduledAt) { setError('Choose a collector and a time'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionAssignParcelCollector(parcelId, {
        collectorPartyId: selected.PartyID, scheduledAt: new Date(scheduledAt).toISOString(), note: note.trim() || undefined,
      });
      if (!result.ok) setError(result.error);
      else { announce('Collection scheduled', 'assertive'); onDone(); }
    });
  }

  return (
    <Panel title="Schedule collection">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input placeholder="Search collector by name or phone" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()} style={{ flex: 1, ...INPUT }} />
        <button className="btn btn-o btn-sm" onClick={search} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </div>
      {collectors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {collectors.map((c) => (
            <button key={c.PartyID} className="btn btn-o btn-sm"
              style={{ justifyContent: 'flex-start', background: selected?.PartyID === c.PartyID ? 'var(--blue-t)' : undefined }}
              onClick={() => setSelected(c)}>
              {c.Name} {c.Msisdn ? `— ${c.Msisdn}` : ''}
            </button>
          ))}
        </div>
      )}
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Collection time
        <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ ...INPUT, display: 'block' }} />
      </label>
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...INPUT, display: 'block', width: '100%' }} />
      </label>
      <button className="btn btn-p btn-sm" disabled={pending} onClick={submit}>{pending ? 'Scheduling…' : 'Schedule & notify sender'}</button>
      <ActionError error={error} />
    </Panel>
  );
}

function CancelPanel({ parcelId, onDone }: { parcelId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function submit() {
    if (!reason.trim()) { setError('A reason is required — it goes to the sender by SMS.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionCancelParcel(parcelId, reason.trim());
      if (!result.ok) setError(result.error);
      else { announce('Parcel cancelled', 'assertive'); onDone(); }
    });
  }

  return (
    <Panel title="Cancel this parcel" tone="red">
      <p className="sub" style={{ margin: '0 0 10px' }}>
        Esoqo points are refunded automatically. An M-Pesa payment is flagged for a manual refund —
        there is no automatic M-Pesa reversal yet.
      </p>
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Reason (sent to the sender)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sender requested cancellation"
          style={{ ...INPUT, display: 'block', width: '100%' }} />
      </label>
      <button className="btn btn-p btn-sm" style={{ background: 'var(--red)' }} disabled={pending} onClick={submit}>
        {pending ? 'Cancelling…' : 'Cancel parcel & notify sender'}
      </button>
      <ActionError error={error} />
    </Panel>
  );
}

function FlagPanel({ parcelId, onDone }: { parcelId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function submit() {
    if (!note.trim()) { setError('A note is required — this is what tells ops what to look into.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionFlagParcelException(parcelId, note.trim());
      if (!result.ok) setError(result.error);
      else { announce('Parcel flagged', 'assertive'); onDone(); }
    });
  }

  return (
    <Panel title="Flag this parcel" tone="amber">
      <p className="sub" style={{ margin: '0 0 10px' }}>
        Doesn&apos;t stop or change the parcel — just marks it for attention (stuck, no courier
        update, a complaint, anything worth a second look).
      </p>
      <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Courier unreachable since yesterday"
          style={{ ...INPUT, display: 'block', width: '100%' }} />
      </label>
      <button className="btn btn-p btn-sm" style={{ background: 'var(--amber)' }} disabled={pending} onClick={submit}>
        {pending ? 'Flagging…' : 'Flag exception'}
      </button>
      <ActionError error={error} />
    </Panel>
  );
}

function ConfirmIntakeButton({ code }: { code: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <span>
      <button className="btn btn-p btn-sm" disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await actionConfirmParcelIntake(code);
          if (!result.ok) setError(result.error);
          else announce('Confirmed received — sender and receiver texted', 'assertive');
        })}>
        <Icon name="check-circle" size={13} />{pending ? 'Confirming…' : 'Confirm received'}
      </button>
      <ActionError error={error} />
    </span>
  );
}

function RefundButton({ parcelId }: { parcelId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <span>
      <button className="btn btn-o btn-sm" disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await actionMarkParcelRefunded(parcelId);
          if (!result.ok) setError(result.error);
          else announce('Refund marked as processed', 'assertive');
        })}>
        <Icon name="check" size={13} />{pending ? 'Marking…' : 'Mark refunded'}
      </button>
      <ActionError error={error} />
    </span>
  );
}

function ClearExceptionButton({ parcelId }: { parcelId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <span>
      <button className="btn btn-o btn-sm" disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await actionClearParcelException(parcelId);
          if (!result.ok) setError(result.error);
          else announce('Exception cleared', 'assertive');
        })}>
        <Icon name="check" size={13} />{pending ? 'Clearing…' : 'Clear exception'}
      </button>
      <ActionError error={error} />
    </span>
  );
}

/** The three receiver-verification verbs share a shape — one POST, no
 *  input, a confirmation to announce — so they share a button rather
 *  than three near-identical copies of ClearExceptionButton. */
function ReceiverAuthButton({
  parcelId, label, icon, done, action,
}: {
  parcelId: string;
  label: string;
  icon: IconName;
  done: string;
  action: (parcelId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <span>
      <button className="btn btn-o btn-sm" disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await action(parcelId);
          if (!result.ok) setError(result.error);
          else announce(done, 'assertive');
        })}>
        <Icon name={icon} size={13} />{pending ? 'Working…' : label}
      </button>
      <ActionError error={error} />
    </span>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: 'red' | 'amber'; children: React.ReactNode }) {
  const bg = tone === 'red' ? 'var(--red-t)' : tone === 'amber' ? 'var(--amber-t)' : 'var(--paper)';
  const color = tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : undefined;
  return (
    <div style={{ background: bg, border: '1px solid var(--line)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <strong style={{ color, display: 'block', marginBottom: 8 }}>{title}</strong>
      {children}
    </div>
  );
}

const INPUT = { padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 };
