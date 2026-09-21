'use server';

import { revalidatePath } from 'next/cache';
import { AuthorisationError } from '@esoqo/db';
import {
  boardLuggage, claimLuggage, listTripLuggage, tagLuggage,
  type LuggageClaimMethod, type LuggageClaimResult, type LuggageTag,
  type TagLuggageInput,
} from '@/lib/luggage';

/**
 * The four crew actions. Deliberately thin: every rule that matters
 * (who may do this, whether the trip is open, whether an override needs
 * a reason) lives in core-go's DAL, and duplicating any of it here
 * would create a second place for it to be wrong.
 */

export type LuggageResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toMessage(e: unknown): string {
  if (e instanceof AuthorisationError) return 'Your role does not allow that.';
  return e instanceof Error ? e.message : 'That did not work';
}

export async function actionTagLuggage(
  orgId: string,
  input: TagLuggageInput,
): Promise<LuggageResult<LuggageTag[]>> {
  try {
    if (!input.passengerName.trim()) return { ok: false, error: 'Whose bag is it?' };
    if (!input.destinationLabel.trim()) return { ok: false, error: 'Where does it come off?' };
    const tags = await tagLuggage(orgId, input);
    revalidatePath(`/org/${orgId}/luggage`);
    return { ok: true, data: tags };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function actionBoardLuggage(
  orgId: string,
  code: string,
): Promise<LuggageResult<LuggageTag>> {
  try {
    const tag = await boardLuggage(orgId, code);
    return { ok: true, data: tag };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function actionClaimLuggage(
  orgId: string,
  code: string,
  method: LuggageClaimMethod,
  overrideReason?: string,
): Promise<LuggageResult<LuggageClaimResult>> {
  try {
    const res = await claimLuggage(orgId, code, method, overrideReason);
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/** Used by the board's own refresh, so the manifest reflects what other
 *  crew on the same trip have scanned without anyone reloading. */
export async function actionListTripLuggage(
  orgId: string,
  tripId: string,
): Promise<LuggageResult<LuggageTag[]>> {
  try {
    return { ok: true, data: await listTripLuggage(orgId, tripId) };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
