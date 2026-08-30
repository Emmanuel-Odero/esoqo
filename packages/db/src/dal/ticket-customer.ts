import { prisma } from '../client';

/**
 * Ticket buyers and their loyalty points — the ticketing equivalent of
 * dal/customer.ts's StoreCustomer/LoyaltyEntry pair. Kept as its own
 * table (TicketCustomer/TicketLoyaltyEntry) rather than reusing those
 * because StoreCustomer.storeId is a required FK and a TicketOrg is
 * not a Store. Same "balances are derived" rule: a points balance is
 * the sum of TicketLoyaltyEntry rows, never a stored running total.
 */

/**
 * Finds or creates an org's ticket-customer record by phone — the same
 * "auto capture" moment findOrCreateCustomer does for a shop: a buyer
 * doesn't need to be deliberately added first, signed in or not.
 * Called from createBooking with whatever ctx it already has (SUBJECT
 * or anonCtx), same reasoning as that function's own comment.
 */
export async function findOrCreateTicketCustomer(
  orgId: string,
  msisdn: string,
  name?: string | null,
  email?: string | null,
) {
  const trimmed = msisdn.trim();
  if (!trimmed) return null;

  const existing = await prisma.ticketCustomer.findUnique({ where: { orgId_msisdn: { orgId, msisdn: trimmed } } });
  if (existing) {
    // Fill in whatever's missing without overwriting what's already on
    // file — a later booking with no email shouldn't blank out one an
    // earlier booking supplied.
    const patch: { name?: string; email?: string } = {};
    if (name && !existing.name) patch.name = name;
    if (email && !existing.email) patch.email = email;
    if (Object.keys(patch).length === 0) return existing;
    return prisma.ticketCustomer.update({ where: { id: existing.id }, data: patch });
  }
  return prisma.ticketCustomer.create({
    data: { orgId, msisdn: trimmed, name: name || null, email: email || null },
  });
}

function pointsOf(entries: { points: number }[]) {
  return entries.reduce((sum, e) => sum + e.points, 0);
}

export async function getTicketCustomerPoints(customerId: string) {
  const entries = await prisma.ticketLoyaltyEntry.findMany({ where: { customerId }, select: { points: true } });
  return pointsOf(entries);
}

/** Points earned on a paid booking — org.loyaltyPerKes points per whole
 *  KES. A no-op when the org hasn't turned loyalty on. Called right
 *  after a booking is committed PAID, whether that happens immediately
 *  (CASH) or later via the M-Pesa callback — never a standalone Server
 *  Action, same boundary as earnLoyaltyForSale. */
export async function earnLoyaltyForBooking(
  orgId: string,
  customerId: string,
  totalKes: number,
  bookingId: string,
) {
  const org = await prisma.ticketOrg.findUnique({ where: { id: orgId }, select: { loyaltyEnabled: true, loyaltyPerKes: true } });
  if (!org?.loyaltyEnabled || org.loyaltyPerKes <= 0) return null;

  const points = Math.floor(totalKes * org.loyaltyPerKes);
  if (points <= 0) return null;

  return prisma.ticketLoyaltyEntry.create({
    data: { customerId, points, kind: 'EARN', bookingId },
  });
}
