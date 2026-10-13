'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@esoqo/ui';
import type { OrgParcelRow } from '@/lib/parcel-org-session';
import { updateOrgParcelDetails } from './actions';

/**
 * A clerk's fix for a mistyped booking, from the parcel drawer.
 *
 * The counter form can already reopen a held label or a saved draft
 * (see ParcelCounter's "Edit details"), but a parcel that was actually
 * booked — the common case for pay-at-counter, where the box is on the
 * shelf before anyone has paid — had no way back in. A wrong receiver
 * number meant either living with it or cancelling and re-booking.
 *
 * Same three facts the admin/sender correction already edits (receiver
 * name/phone, destination, notes), for the same reason: origin is the
 * paying account, not a desk-editable detail, and the window closes the
 * moment a courier takes custody — by then the box is labelled and
 * moving (see dbx.UpdateOrgParcelDetails). Gated on parcelorg.intake,
 * the capability the front desk already holds.
 */
export function EditParcelDetails({
  parcel, onDone,
}: {
  parcel: OrgParcelRow;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [receiverName, setReceiverName] = useState(parcel.receiverName);
  const [receiverMsisdn, setReceiverMsisdn] = useState(parcel.receiverMsisdn);
  const [destinationLabel, setDestinationLabel] = useState(parcel.destinationLabel);
  const [notes, setNotes] = useState(parcel.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = Boolean(
    receiverName.trim() && receiverMsisdn.trim() && destinationLabel.trim(),
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateOrgParcelDetails(parcel.code, {
        receiverName, receiverMsisdn, destinationLabel,
        notes: notes.trim() || null,
      });
      if (!res.ok) { setError(res.error); return; }
      onDone();
    });
  }

  return (
    <>
      <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
        Edit details
      </button>
      {open && (
        <Modal
          title={`Edit ${parcel.code}`}
          subtitle="Fix a mistyped receiver, destination or note — before a courier picks the parcel up."
          onClose={() => { setOpen(false); setError(null); }}
          footer={(
            <>
              <button className="btn btn-p" disabled={pending || !ready} onClick={submit}>
                {pending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                className="btn btn-o"
                disabled={pending}
                onClick={() => { setOpen(false); setError(null); }}
              >
                Cancel
              </button>
            </>
          )}
        >
          {error && <p className="pnote pnote-bad" role="alert">{error}</p>}
          <div className="pgrid">
            <label className="pfield"><span>Receiver name</span>
              <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </label>
            <label className="pfield"><span>Receiver phone</span>
              <input className="mono" value={receiverMsisdn} inputMode="tel" placeholder="07…"
                onChange={(e) => setReceiverMsisdn(e.target.value)} />
            </label>
            <label className="pfield"><span>Destination</span>
              <input value={destinationLabel} onChange={(e) => setDestinationLabel(e.target.value)} />
            </label>
            <label className="pfield"><span>Notes</span>
              <textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
