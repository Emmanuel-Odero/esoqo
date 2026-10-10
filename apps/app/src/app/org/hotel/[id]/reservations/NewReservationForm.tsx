'use client';

import { useState, useTransition } from 'react';
import { createReservation } from './actions';

export function NewReservationForm({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError('');
    start(async () => {
      try {
        await createReservation(orgId, {
          guestName: fd.get('guestName') as string,
          guestPhone: fd.get('guestPhone') as string,
          roomNumber: fd.get('roomNumber') as string,
          checkInDate: fd.get('checkInDate') as string,
          checkOutDate: fd.get('checkOutDate') as string,
          adults: Number(fd.get('adults') || 1),
          children: Number(fd.get('children') || 0),
          notes: fd.get('notes') as string,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create reservation');
      }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">
        + New Reservation
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="modal" role="presentation" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Reservation</h2>
              <button onClick={() => setOpen(false)} className="close-btn">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="res-form">
              <label>Guest Name *
                <input name="guestName" required placeholder="Full name" />
              </label>
              <label>Phone
                <input name="guestPhone" placeholder="+254..." />
              </label>
              <label>Room Number *
                <input name="roomNumber" required placeholder="101" />
              </label>
              <div className="form-row">
                <label>Check-in *
                  <input name="checkInDate" type="date" required />
                </label>
                <label>Check-out *
                  <input name="checkOutDate" type="date" required />
                </label>
              </div>
              <div className="form-row">
                <label>Adults
                  <input name="adults" type="number" min="1" defaultValue="1" />
                </label>
                <label>Children
                  <input name="children" type="number" min="0" defaultValue="0" />
                </label>
              </div>
              <label>Notes
                <textarea name="notes" rows={2} placeholder="Special requests…" />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div className="form-actions">
                <button type="button" onClick={() => setOpen(false)} className="btn-cancel">
                  Cancel
                </button>
                <button type="submit" disabled={pending} className="btn-submit">
                  {pending ? 'Creating…' : 'Create Reservation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .btn-primary { padding: .5rem 1rem; background: #7c3aed; color: white; border: none; border-radius: .375rem; font-size: .875rem; font-weight: 500; cursor: pointer; }
        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .modal { background: white; border-radius: .5rem; padding: 1.5rem; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .modal-header h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
        .close-btn { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: #6b7280; }
        .res-form { display: flex; flex-direction: column; gap: .75rem; }
        .res-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .875rem; font-weight: 500; }
        .res-form input, .res-form textarea { padding: .5rem .75rem; border: 1px solid #d1d5db; border-radius: .375rem; font-size: .875rem; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
        .form-error { color: #991b1b; font-size: .875rem; margin: 0; }
        .form-actions { display: flex; gap: .75rem; justify-content: flex-end; margin-top: .5rem; }
        .btn-cancel { padding: .5rem 1rem; background: #f3f4f6; border: none; border-radius: .375rem; font-size: .875rem; cursor: pointer; }
        .btn-submit { padding: .5rem 1rem; background: #7c3aed; color: white; border: none; border-radius: .375rem; font-size: .875rem; font-weight: 500; cursor: pointer; }
        .btn-submit:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </>
  );
}
