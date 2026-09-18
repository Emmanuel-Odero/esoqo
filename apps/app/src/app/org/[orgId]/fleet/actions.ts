'use server';

import { revalidatePath } from 'next/cache';
import { AuthorisationError } from '@esoqo/db';
import {
  closeFleetTrip, createShortRoute, startTrip,
} from '@/lib/fleet';

export type FleetActionResult = { ok: true } | { ok: false; error: string };

function toMessage(e: unknown): string {
  if (e instanceof AuthorisationError) return 'Your role does not allow that.';
  return e instanceof Error ? e.message : 'That did not work';
}

export async function actionStartTrip(
  orgId: string,
  input: { vehicleId: string; driverId?: string | null; conductorId?: string | null; shortRouteId?: string | null },
): Promise<FleetActionResult> {
  try {
    await startTrip(orgId, input);
    revalidatePath(`/org/${orgId}/fleet`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function actionCloseTrip(orgId: string, tripId: string): Promise<FleetActionResult> {
  try {
    await closeFleetTrip(orgId, tripId);
    revalidatePath(`/org/${orgId}/fleet`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function actionCreateShortRoute(
  orgId: string,
  name: string,
  stages: { name: string; fareKes: number }[],
): Promise<FleetActionResult> {
  try {
    if (!name.trim()) return { ok: false, error: 'Give the route a name' };
    if (stages.length < 2) return { ok: false, error: 'A route needs at least a start and an end stage' };
    await createShortRoute(orgId, name.trim(), stages);
    revalidatePath(`/org/${orgId}/fleet/pricing`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
