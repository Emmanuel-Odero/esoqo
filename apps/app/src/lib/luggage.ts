import 'server-only';
import { orgGo } from './ticketing';

/**
 * Passenger luggage reads/writes for the organiser console —
 * core-go's /v1/fleet/luggage* and /v1/fleet/trips/:id/luggage (see
 * services/core-go/internal/dbx/luggage.go).
 *
 * Field names mirror core-go's JSON verbatim, and unlike the older
 * fleet structs in ./fleet.ts these are all properly json-tagged
 * camelCase, so there are no Go-field-name keys to preserve here.
 *
 * Capability-checked server-side on every call (luggage.tag /
 * luggage.claim / luggage.read); the console's job is only to avoid
 * asking for what the session cannot see.
 */

export type LuggageStatus = 'TAGGED' | 'ABOARD' | 'CLAIMED' | 'UNCLAIMED';
export type LuggageClaimMethod = 'STUB_SCAN' | 'CODE_TYPED' | 'TICKET_MATCH' | 'OVERRIDE';

export interface LuggageTag {
  id: string;
  code: string;
  tripId: string;
  orgId: string;
  ticketId?: string;
  passengerName: string;
  passengerMsisdn?: string;
  pieceNo: number;
  pieceCount: number;
  groupId?: string;
  dropStageId?: string;
  destinationLabel: string;
  weightKg?: string;
  excessFeeKes?: string;
  photoUrl?: string;
  status: LuggageStatus;
  boardedAt?: string;
  claimedAt?: string;
  claimMethod?: LuggageClaimMethod;
  createdAt: string;
}

export interface LuggageClaimResult {
  tag: LuggageTag;
  /** The passenger's other pieces, in piece order. */
  siblings: LuggageTag[];
  /** How many of those are still on the vehicle — the number the claim
   *  screen shows next to the tick. */
  siblingsStillAboard: number;
}

export interface TagLuggageInput {
  tripId: string;
  passengerName: string;
  destinationLabel: string;
  passengerMsisdn?: string | null;
  ticketId?: string | null;
  pieceCount?: number;
  dropStageId?: string | null;
  weightKg?: string | null;
  excessFeeKes?: string | null;
}

/** Every piece of one passenger's luggage, in one call — see
 *  dbx.TagLuggage on why all pieces go together rather than one per
 *  bag ("2 of 3" is only true once all three exist, and it is one round
 *  trip rather than three on a connection that may not survive). */
export async function tagLuggage(
  orgId: string,
  input: TagLuggageInput,
): Promise<LuggageTag[]> {
  const { tags } = await orgGo<{ tags: LuggageTag[] | null }>(orgId, '/v1/fleet/luggage', {
    method: 'POST',
    body: JSON.stringify({
      tripId: input.tripId,
      passengerName: input.passengerName,
      destinationLabel: input.destinationLabel,
      passengerMsisdn: input.passengerMsisdn || null,
      ticketId: input.ticketId || null,
      pieceCount: input.pieceCount ?? 1,
      dropStageId: input.dropStageId || null,
      weightKg: input.weightKg || null,
      excessFeeKes: input.excessFeeKes || null,
    }),
  });
  return tags ?? [];
}

/** The scan that puts a tagged bag physically aboard. Idempotent
 *  server-side, so a double-scan at a noisy stage is a no-op rather
 *  than an error the conductor has to stop and read. */
export async function boardLuggage(orgId: string, code: string): Promise<LuggageTag> {
  const { tag } = await orgGo<{ tag: LuggageTag }>(
    orgId, `/v1/fleet/luggage/${encodeURIComponent(code)}/board`, { method: 'POST', body: '{}' },
  );
  return tag;
}

/** Hand a bag back. Returns the passenger's other pieces alongside,
 *  because the moment has no room for a second round trip. */
export async function claimLuggage(
  orgId: string,
  code: string,
  method: LuggageClaimMethod,
  overrideReason?: string,
): Promise<LuggageClaimResult> {
  return orgGo<LuggageClaimResult>(
    orgId, `/v1/fleet/luggage/${encodeURIComponent(code)}/claim`,
    { method: 'POST', body: JSON.stringify({ method, overrideReason: overrideReason || null }) },
  );
}

/** What is on this vehicle, already ordered by drop stage then
 *  passenger then piece — the order the job is done in. */
export async function listTripLuggage(orgId: string, tripId: string): Promise<LuggageTag[]> {
  const { luggage } = await orgGo<{ luggage: LuggageTag[] | null }>(
    orgId, `/v1/fleet/trips/${tripId}/luggage`,
  );
  return luggage ?? [];
}
