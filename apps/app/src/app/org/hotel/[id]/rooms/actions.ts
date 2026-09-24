'use server';

import { revalidatePath } from 'next/cache';
import { orgFetch } from '@/lib/org-session';

export async function updateRoomStatus(
  orgId: string,
  roomNumber: string,
  status: string,
): Promise<void> {
  await orgFetch<{ ok: boolean }>('hotel', `/v1/hotels/${orgId}/rooms/${roomNumber}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  revalidatePath(`/org/hotel/${orgId}/rooms`);
}

export async function createRoom(orgId: string, data: {
  number: string;
  type: string;
  floor: number;
  maxGuests: number;
  pricePerNight: number;
  amenities: string[];
}): Promise<void> {
  await orgFetch('hotel', `/v1/hotels/${orgId}/rooms`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  revalidatePath(`/org/hotel/${orgId}/rooms`);
}
