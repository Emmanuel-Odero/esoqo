/**
 * Hotel Portal — Reservations
 * Lists all reservations with check-in/check-out actions.
 */
import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import { hotelFetch } from '../hotel-fetch';
import { CheckInButton, CheckOutButton } from './ReservationActions';
import { NewReservationForm } from './NewReservationForm';

export const metadata = { title: 'Reservations' };

interface ReservationData {
  id: string;
  guestName: string;
  guestPhone: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  notes: string;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
}

interface ReservationsResponse {
  reservations: Array<{ id: string; configKey: string; configData: string | ReservationData }>;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  confirmed:   { bg: '#dbeafe', text: '#1e40af', label: 'Confirmed' },
  checked_in:  { bg: '#d1fae5', text: '#065f46', label: 'Checked In' },
  checked_out: { bg: '#f3f4f6', text: '#374151', label: 'Checked Out' },
  cancelled:   { bg: '#fee2e2', text: '#991b1b', label: 'Cancelled' },
};

const FALLBACK_BADGE = { bg: '#dbeafe', text: '#1e40af', label: 'Confirmed' };

export default async function HotelReservationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  const [me, resResponse] = await Promise.all([
    fetchOrgMe(orgId, 'hotel').catch(() => null),
    hotelFetch<ReservationsResponse>(orgId, `/v1/hotels/${orgId}/reservations`).catch(() => ({
      reservations: [],
    })),
  ]);

  if (!me) notFound();

  const canWrite = me.capabilities.includes('hotel.reservations.write');

  const reservations: ReservationData[] = (resResponse.reservations ?? []).map((r) => {
    const d = typeof r.configData === 'string' ? JSON.parse(r.configData) : r.configData;
    return d as ReservationData;
  });

  // Sort: checked-in first, then confirmed, then others
  const order: Record<string, number> = { checked_in: 0, confirmed: 1, checked_out: 2, cancelled: 3 };
  reservations.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <main className="hotel-main">
      <div className="hotel-page-header">
        <div>
          <h1>Reservations</h1>
          <p className="subtitle">{reservations.length} total</p>
        </div>
        {canWrite && <NewReservationForm orgId={orgId} />}
      </div>

      {reservations.length === 0 ? (
        <div className="empty-state">No reservations yet.</div>
      ) : (
        <div className="res-table">
          <div className="res-header">
            <span>Guest</span>
            <span>Room</span>
            <span>Check-in</span>
            <span>Check-out</span>
            <span>Status</span>
            {canWrite && <span>Actions</span>}
          </div>
          {reservations.map((res) => {
            const badge = STATUS_BADGE[res.status] ?? FALLBACK_BADGE;
            return (
              <div key={res.id} className="res-row">
                <div className="res-guest">
                  <span className="guest-name">{res.guestName}</span>
                  {res.guestPhone && <span className="guest-phone">{res.guestPhone}</span>}
                </div>
                <span className="res-room">Room {res.roomNumber}</span>
                <span>{res.checkInDate}</span>
                <span>{res.checkOutDate}</span>
                <span
                  className="res-badge"
                  style={{ background: badge?.bg, color: badge?.text }}
                >
                  {badge?.label}
                </span>
                {canWrite && (
                  <div className="res-actions">
                    {res.status === 'confirmed' && (
                      <CheckInButton orgId={orgId} reservationId={res.id} />
                    )}
                    {res.status === 'checked_in' && (
                      <CheckOutButton orgId={orgId} reservationId={res.id} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .hotel-main { padding: 1.5rem; max-width: 1100px; }
        .hotel-page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap; }
        .hotel-page-header h1 { margin: 0 0 .25rem; font-size: 1.5rem; font-weight: 700; }
        .subtitle { margin: 0; color: #6b7280; font-size: .875rem; }
        .empty-state { padding: 2rem; text-align: center; color: #6b7280; background: #f9fafb; border-radius: .5rem; }
        .res-table { display: flex; flex-direction: column; border: 1px solid #e5e7eb; border-radius: .5rem; overflow: hidden; }
        .res-header, .res-row { display: grid; grid-template-columns: 1.5fr 80px 100px 100px 110px${canWrite ? ' auto' : ''}; gap: 1rem; padding: .75rem 1rem; align-items: center; font-size: .875rem; }
        .res-header { background: #f9fafb; font-weight: 600; color: #374151; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
        .res-row { border-top: 1px solid #f3f4f6; }
        .res-row:hover { background: #fafafa; }
        .res-guest { display: flex; flex-direction: column; gap: .1rem; }
        .guest-name { font-weight: 500; }
        .guest-phone { font-size: .8rem; color: #6b7280; }
        .res-room { font-weight: 500; }
        .res-badge { padding: .2rem .6rem; border-radius: 9999px; font-size: .75rem; font-weight: 600; white-space: nowrap; }
        .res-actions { display: flex; gap: .5rem; }
      `}</style>
    </main>
  );
}
