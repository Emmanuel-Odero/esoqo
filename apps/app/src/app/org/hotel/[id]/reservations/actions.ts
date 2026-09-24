'use server';

import { revalidatePath } from 'next/cache';
import { orgFetch } from '@/lib/org-session';

export async function checkInGuest(orgId: string, reservationId: string): Promise<void> {
  await orgFetch('hotel', `/v1/hotels/${orgId}/reservations/${reservationId}/checkin`, {
    method: 'POST',
    body: '{}',
  });
  revalidatePath(`/org/hotel/${orgId}/reservations`);
  revalidatePath(`/org/hotel/${orgId}/rooms`);
}

export async function checkOutGuest(orgId: string, reservationId: string): Promise<void> {
  await orgFetch('hotel', `/v1/hotels/${orgId}/reservations/${reservationId}/checkout`, {
    method: 'POST',
    body: '{}',
  });
  revalidatePath(`/org/hotel/${orgId}/reservations`);
  revalidatePath(`/org/hotel/${orgId}/rooms`);
}

export async function createReservation(
  orgId: string,
  data: {
    guestName: string;
    guestPhone: string;
    roomNumber: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    children: number;
    notes: string;
  },
): Promise<{ id: string }> {
  const res = await orgFetch<{ reservation: { id: string } }>(
    'hotel',
    `/v1/hotels/${orgId}/reservations`,
    { method: 'POST', body: JSON.stringify(data) },
  );
  revalidatePath(`/org/hotel/${orgId}/reservations`);
  return res.reservation;
}
