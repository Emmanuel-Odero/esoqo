/**
 * Hotel Portal — Rooms
 * Lists all rooms with status, and lets receptionists update room status.
 */
import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import { hotelFetch } from '../hotel-fetch';
import { RoomStatusForm } from './RoomStatusForm';

export const metadata = { title: 'Rooms' };

interface Room {
  id: string;
  configKey: string;
  configData: {
    number: string;
    type: string;
    floor: number;
    maxGuests: number;
    pricePerNight: number;
    amenities: string[];
    status: 'available' | 'occupied' | 'maintenance';
    currentReservationId?: string;
  };
}

interface RoomsResponse {
  rooms: Array<{ id: string; configKey: string; configData: string }>;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#d1fae5',
  occupied: '#fef3c7',
  maintenance: '#fee2e2',
};

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  occupied: 'Occupied',
  maintenance: 'Maintenance',
};

export default async function HotelRoomsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  const [me, roomsRes] = await Promise.all([
    fetchOrgMe(orgId, 'hotel').catch(() => null),
    hotelFetch<RoomsResponse>(orgId, `/v1/hotels/${orgId}/rooms`).catch(() => ({ rooms: [] })),
  ]);

  if (!me) notFound();

  const canWrite = me.capabilities.includes('hotel.rooms.write');

  // Parse configData from JSON strings
  const rooms: Room[] = (roomsRes.rooms ?? []).map((r) => ({
    id: r.id,
    configKey: r.configKey,
    configData:
      typeof r.configData === 'string' ? JSON.parse(r.configData) : r.configData,
  }));

  return (
    <main className="hotel-main">
      <div className="hotel-page-header">
        <h1>Rooms</h1>
        {canWrite && (
          <a href={`/org/hotel/${orgId}/rooms/new`} className="btn-primary">
            + Add Room
          </a>
        )}
      </div>

      {rooms.length === 0 ? (
        <div className="empty-state">
          <p>No rooms configured yet.</p>
          {canWrite && (
            <a href={`/org/hotel/${orgId}/rooms/new`} className="btn-primary">
              Add your first room
            </a>
          )}
        </div>
      ) : (
        <div className="rooms-grid">
          {rooms.map((room) => {
            const d = room.configData;
            const bg = STATUS_COLOR[d.status] ?? '#f3f4f6';
            return (
              <div key={room.id} className="room-card" style={{ background: bg }}>
                <div className="room-number">Room {d.number}</div>
                <div className="room-type">{d.type} · Floor {d.floor}</div>
                <div className="room-price">KES {d.pricePerNight?.toLocaleString() ?? '—'}/night</div>
                <div className="room-guests">Max {d.maxGuests} guests</div>
                <div className="room-status">{STATUS_LABEL[d.status] ?? d.status}</div>
                {canWrite && (
                  <RoomStatusForm
                    orgId={orgId}
                    roomNumber={d.number}
                    currentStatus={d.status}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .hotel-main { padding: 1.5rem; max-width: 1100px; }
        .hotel-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .hotel-page-header h1 { margin: 0; font-size: 1.5rem; font-weight: 700; }
        .btn-primary { padding: .5rem 1rem; background: #7c3aed; color: white; border-radius: .375rem; text-decoration: none; font-size: .875rem; font-weight: 500; }
        .empty-state { padding: 2rem; text-align: center; background: #f9fafb; border-radius: .5rem; }
        .rooms-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
        .room-card { padding: 1rem; border-radius: .5rem; border: 1px solid rgba(0,0,0,.08); display: flex; flex-direction: column; gap: .4rem; }
        .room-number { font-size: 1.1rem; font-weight: 700; }
        .room-type { font-size: .8rem; text-transform: capitalize; color: #374151; }
        .room-price { font-size: .875rem; font-weight: 500; }
        .room-guests { font-size: .8rem; color: #6b7280; }
        .room-status { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
      `}</style>
    </main>
  );
}
