'use server';

import {
  anonCtx,
  findPayableGroups,
  lookupPayee,
  lookupPayeeByPlate,
  type PayableBusiness,
} from '@esoqo/db';

/**
 * Lookups for the group and transport pages.
 *
 * Both are the same two-step shape as /pay/business — find who you are
 * paying, then hand the customer to the existing payment flow — so the
 * only thing that differs is how a name becomes an organisation:
 *
 *   /pay/group     narrowed to group kinds, so a chama search cannot
 *                  offer a warehouse.
 *   /pay/transport company name, or a number plate resolved up the
 *                  fleet to the company that owns the vehicle.
 *
 * Neither returns anything the general lookup does not: no contact
 * details, no owner, just the public payee projection.
 */

const ctx = anonCtx();

export type TargetLookup =
  | { status: 'FOUND'; targets: PayableBusiness[]; via: 'ID' | 'NAME' | 'PLATE' }
  | { status: 'NOT_FOUND'; hint: string }
  | { status: 'NOT_PAYABLE' }
  | { status: 'EMPTY' };

/**
 * Groups.
 *
 * The hint on a miss is the difference between a dead end and a
 * correction: a member who typed the group's full registered name and
 * found nothing is far more likely to have typed a shop's name than to
 * have mistyped a chama's.
 */
export async function actionLookupGroup(identifier: string): Promise<TargetLookup> {
  const raw = identifier.trim();
  if (!raw) return { status: 'EMPTY' };
  const groups = await findPayableGroups(ctx, raw).catch(() => null);
  if (groups === null) return { status: 'NOT_FOUND', hint: 'We could not search just now. Please try again.' };
  if (groups.length > 0) {
    return { status: 'FOUND', targets: groups, via: raw.includes('-') && raw.length > 8 ? 'ID' : 'NAME' };
  }
  // Fall back to the unfiltered search before saying no, so that a group
  // registered under a kind this page does not list is still payable —
  // found, if not as a "group".
  const any = await lookupPayee(ctx, raw).catch(() => null);
  if (any?.status === 'FOUND') {
    return { status: 'FOUND', targets: any.businesses, via: 'NAME' };
  }
  if (any?.status === 'NOT_PAYABLE') return { status: 'NOT_PAYABLE' };
  return { status: 'NOT_FOUND', hint: 'No group matches that. Check the name, or use the group’s Esoqo ID.' };
}

/** A plate is six or seven characters of letter and digit; anything with
 *  a space and letters is a company name instead. Getting this wrong
 *  means a driver typing "KCB 123A" is told to try a company name, so
 *  the bar is deliberately low and the name search is the fallback. */
function looksLikePlate(raw: string): boolean {
  const squashed = raw.replace(/[\s-]/g, '');
  return /^[A-Z]{2,4}\d{2,4}[A-Z]?$/i.test(squashed) && squashed.length >= 5 && squashed.length <= 10;
}

export async function actionLookupTransport(identifier: string): Promise<TargetLookup> {
  const raw = identifier.trim();
  if (!raw) return { status: 'EMPTY' };

  if (looksLikePlate(raw)) {
    const byPlate = await lookupPayeeByPlate(raw).catch(() => null);
    if (byPlate?.status === 'FOUND' && byPlate.businesses.length > 0) {
      return { status: 'FOUND', targets: byPlate.businesses, via: 'PLATE' };
    }
    // A plate that resolves to nothing falls through to the name search
    // rather than dead-ending: people mistype plates constantly, and a
    // company name is the more forgiving second chance.
  }

  const byName = await lookupPayee(ctx, raw).catch(() => null);
  if (byName?.status === 'FOUND' && byName.businesses.length > 0) {
    return { status: 'FOUND', targets: byName.businesses, via: 'NAME' };
  }
  if (byName?.status === 'NOT_PAYABLE') return { status: 'NOT_PAYABLE' };
  return {
    status: 'NOT_FOUND',
    hint: looksLikePlate(raw)
      ? 'No company has that plate on Esoqo. Check the number, or search by name instead.'
      : 'No company matches that. Check the name, or search by number plate instead.',
  };
}
