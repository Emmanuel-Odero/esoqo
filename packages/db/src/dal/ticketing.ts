import { prisma } from '../client';
import { requireCapability, AuthorisationError, systemCtx, type Capability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { randomBytes } from 'node:crypto';

/**
 * Ticketing — event companies, tour/travel operators and transport
 * (bus/matatu SACCO) companies.
 *
 * A TicketOrg belongs to an Enterprise, exactly like Store — the owner
 * must already be a registered, credentialed subject and the onboarding
 * path is identical to opening a shop. Org-scoped staff (admin/manager/
 * scanner) are a TicketOrgStaff, the ticketing equivalent of Cashier:
 * a PIN login scoped to one org, not a Party. See
 * TICKETING_STAFF_CAPABILITIES in ../capabilities.ts and
 * docs/proposals/esoko-ticketing-platform.md for the full design.
 */

export class TicketingError extends Error {
  constructor(
    msg: string,
    public readonly code: 'NOT_FOUND' | 'SLUG_TAKEN' | 'NOT_YOUR_ENTERPRISE' | 'BAD_INPUT' | 'SOLD_OUT' | 'SEAT_TAKEN',
  ) {
    super(msg);
    this.name = 'TicketingError';
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

async function uniqueSlug(name: string, exists: (slug: string) => Promise<boolean>) {
  const base = slugify(name);
  let slug = base;
  for (let n = 1; await exists(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Loads a TicketOrg and checks the caller may act on it as `capability`.
 * Two callers land here, exactly the two shapes assertOwnsStore
 * handles:
 *   · a SUBJECT (the owner) — authorised via the enterprise's partyId,
 *     matching the ':own' qualifier on their capability.
 *   · an AGENT (a TicketOrgStaff session) — authorised by ctx.ticketOrgId
 *     matching this org and holding the capability outright, no
 *     qualifier — the session's capability list already IS the
 *     org-scoped grant.
 */
export async function assertOwnsOrg(ctx: Ctx, orgId: string, capability: Capability) {
  const org = await prisma.ticketOrg.findUnique({ where: { id: orgId }, include: { enterprise: true } });
  if (!org) throw new TicketingError('Organiser not found', 'NOT_FOUND');

  if (ctx.actorType === 'AGENT' && ctx.ticketOrgId) {
    if (ctx.ticketOrgId !== orgId) throw new AuthorisationError(capability, ctx);
    requireCapability(ctx, capability);
    return org;
  }

  requireCapability(ctx, capability, { partyId: org.enterprise.partyId });
  return org;
}

// ───────────────────────────── Organisers ────────────────────────

export interface CreateTicketOrgInput {
  enterpriseId: string;
  name: string;
  vertical: 'EVENTS' | 'TRANSPORT';
  contactPhone?: string;
  contactEmail?: string;
}

export async function createTicketOrg(ctx: Ctx, input: CreateTicketOrgInput) {
  if (!ctx.partyId) throw new Error('Sign in to register an organiser');

  const enterprise = await prisma.enterprise.findUnique({ where: { id: input.enterpriseId } });
  if (!enterprise || enterprise.partyId !== ctx.partyId) {
    throw new TicketingError('That business is not on your account', 'NOT_YOUR_ENTERPRISE');
  }
  requireCapability(ctx, 'ticketorg.write', { partyId: ctx.partyId });
  if (!input.name.trim()) throw new TicketingError('Give the organiser a name', 'BAD_INPUT');

  const slug = await uniqueSlug(input.name, (s) => prisma.ticketOrg.count({ where: { slug: s } }).then(Boolean));

  const org = await prisma.ticketOrg.create({
    data: {
      enterpriseId: input.enterpriseId,
      name: input.name,
      slug,
      vertical: input.vertical,
      status: 'ACTIVE',
      contactPhone: input.contactPhone || null,
      contactEmail: input.contactEmail || null,
    },
  });

  await recordAudit(ctx, {
    action: 'ticketorg.created',
    targetType: 'ticket_org',
    targetId: org.id,
    payload: { slug, vertical: org.vertical },
  });

  return org;
}

export async function getTicketOrg(ctx: Ctx, orgId: string) {
  return assertOwnsOrg(ctx, orgId, 'ticketorg.read');
}

/** Public lookup by slug — no session, same trust boundary as
 *  getStoreBySlug. Used by the org-staff sign-in page, which only
 *  needs to confirm the org exists and is active before taking a
 *  name+PIN. */
export async function getTicketOrgBySlug(slug: string) {
  return prisma.ticketOrg.findFirst({ where: { slug, status: 'ACTIVE' } });
}

/** Every organiser the signed-in subject owns — drives the /me and
 *  /org[orgId] switcher and the nav's "you run an organiser" branch. */
export async function listMyTicketOrgs(ctx: Ctx) {
  if (!ctx.partyId) return [];
  return prisma.ticketOrg.findMany({
    where: { enterprise: { partyId: ctx.partyId } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function setTicketOrgStatus(ctx: Ctx, orgId: string, status: 'ACTIVE' | 'SUSPENDED') {
  // Suspending someone else's organiser is an oversight action, not an
  // owner one — goes through the plain capability, not assertOwnsOrg's
  // ':own' branch.
  requireCapability(ctx, 'ticketorg.moderate');
  const org = await prisma.ticketOrg.update({ where: { id: orgId }, data: { status } });
  await recordAudit(ctx, { action: 'ticketorg.status_changed', targetType: 'ticket_org', targetId: orgId, payload: { status } });
  return org;
}

// ───────────────────────────── Staff ─────────────────────────────

export interface CreateTicketOrgStaffInput {
  name: string;
  pinHash: string;
  role?: 'ADMIN' | 'MANAGER' | 'SCANNER';
}

export async function createTicketOrgStaff(ctx: Ctx, orgId: string, input: CreateTicketOrgStaffInput) {
  await assertOwnsOrg(ctx, orgId, 'ticketorgstaff.write');
  if (!input.name.trim()) throw new TicketingError('Give the staff member a name', 'BAD_INPUT');

  const staff = await prisma.ticketOrgStaff.create({
    data: { orgId, name: input.name.trim(), pinHash: input.pinHash, role: input.role ?? 'SCANNER' },
  });
  await recordAudit(ctx, { action: 'ticketorgstaff.created', targetType: 'ticket_org_staff', targetId: staff.id, payload: { orgId, role: staff.role } });
  return { id: staff.id, orgId: staff.orgId, name: staff.name, role: staff.role, active: staff.active };
}

export async function listTicketOrgStaff(ctx: Ctx, orgId: string) {
  await assertOwnsOrg(ctx, orgId, 'ticketorgstaff.write');
  return prisma.ticketOrgStaff.findMany({
    where: { orgId },
    select: { id: true, orgId: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
}

export async function setTicketOrgStaffActive(ctx: Ctx, staffId: string, active: boolean) {
  const staff = await prisma.ticketOrgStaff.findUnique({ where: { id: staffId } });
  if (!staff) throw new TicketingError('Staff member not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, staff.orgId, 'ticketorgstaff.write');
  const updated = await prisma.ticketOrgStaff.update({ where: { id: staffId }, data: { active } });
  await recordAudit(ctx, { action: active ? 'ticketorgstaff.reactivated' : 'ticketorgstaff.deactivated', targetType: 'ticket_org_staff', targetId: staffId });
  return { id: updated.id, active: updated.active };
}

/**
 * Staff sign-in lookup — no owner session required, same shape and same
 * reasoning as getCashierPinHashForSignIn: resolved by name (never a
 * staff-id or a picker), scoped by orgSlug (public knowledge, the same
 * trust boundary the /tickets storefront already uses), and returns
 * null rather than throwing on no match so the caller can verify
 * against a dummy hash and keep a wrong name and a wrong PIN
 * indistinguishable in both response and timing.
 */
export async function getTicketOrgStaffForSignIn(orgSlug: string, name: string) {
  const staff = await prisma.ticketOrgStaff.findFirst({
    where: { active: true, name: { equals: name.trim(), mode: 'insensitive' }, org: { slug: orgSlug, status: 'ACTIVE' } },
    include: { org: true },
  });
  if (!staff) return null;
  return { id: staff.id, orgId: staff.orgId, name: staff.name, role: staff.role, pinHash: staff.pinHash };
}

// ─────────────────────── Venues, routes, listings ─────────────────

export async function createVenue(ctx: Ctx, orgId: string, input: { name: string; address?: string; county?: string; capacity?: number }) {
  await assertOwnsOrg(ctx, orgId, 'venue.write');
  return prisma.venue.create({ data: { orgId, name: input.name, address: input.address, county: input.county, capacity: input.capacity } });
}

export async function createRoute(ctx: Ctx, orgId: string, input: { originName: string; destinationName: string; distanceKm?: number }) {
  await assertOwnsOrg(ctx, orgId, 'route.write');
  return prisma.route.create({ data: { orgId, originName: input.originName, destinationName: input.destinationName, distanceKm: input.distanceKm } });
}

/** Picker data for the "new listing" form — every venue/route this
 *  org has on file, whichever the listing needs. */
export async function listOrgVenuesAndRoutes(ctx: Ctx, orgId: string) {
  await assertOwnsOrg(ctx, orgId, 'listing.write');
  const [venues, routes] = await Promise.all([
    prisma.venue.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    prisma.route.findMany({ where: { orgId }, orderBy: { originName: 'asc' } }),
  ]);
  return { venues, routes };
}

export interface CreateListingInput {
  title: string;
  description?: string;
  coverImageUrl?: string;
  venueId?: string;
  routeId?: string;
}

export async function createListing(ctx: Ctx, orgId: string, input: CreateListingInput) {
  await assertOwnsOrg(ctx, orgId, 'listing.write');
  if (!input.title.trim()) throw new TicketingError('Give the listing a title', 'BAD_INPUT');

  const slug = await uniqueSlug(input.title, (s) => prisma.listing.count({ where: { slug: s } }).then(Boolean));
  const listing = await prisma.listing.create({
    data: {
      orgId, title: input.title, slug, description: input.description,
      coverImageUrl: input.coverImageUrl, venueId: input.venueId, routeId: input.routeId,
    },
  });
  await recordAudit(ctx, { action: 'listing.created', targetType: 'listing', targetId: listing.id, payload: { orgId, slug } });
  return listing;
}

/** The org console's listing directory — draft and published alike,
 *  unlike listPublicListings. */
export async function listOrgListings(ctx: Ctx, orgId: string) {
  await assertOwnsOrg(ctx, orgId, 'listing.write');
  return prisma.listing.findMany({
    where: { orgId },
    include: { venue: true, route: true, ticketClasses: true, schedules: { orderBy: { departAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getOrgListing(ctx: Ctx, orgId: string, listingId: string) {
  await assertOwnsOrg(ctx, orgId, 'listing.write');
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, orgId },
    include: {
      venue: true, route: true,
      ticketClasses: true,
      schedules: { orderBy: { departAt: 'asc' }, include: { _count: { select: { bookings: true } } } },
    },
  });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  return listing;
}

export async function publishListing(ctx: Ctx, listingId: string, status: 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED') {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'listing.publish');
  const updated = await prisma.listing.update({ where: { id: listingId }, data: { status } });
  await recordAudit(ctx, { action: 'listing.status_changed', targetType: 'listing', targetId: listingId, payload: { status } });
  return updated;
}

export interface CreateTicketClassInput {
  name: string;
  priceKes: number;
  capacity: number;
  seated?: boolean;
}

export async function createTicketClass(ctx: Ctx, listingId: string, input: CreateTicketClassInput) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'ticketclass.write');
  if (input.capacity < 1) throw new TicketingError('Capacity must be at least 1', 'BAD_INPUT');

  const ticketClass = await prisma.ticketClass.create({
    data: { listingId, name: input.name, priceKes: input.priceKes, capacity: input.capacity, seated: input.seated ?? false },
  });
  await recordAudit(ctx, { action: 'ticketclass.created', targetType: 'ticket_class', targetId: ticketClass.id, payload: { listingId } });
  return ticketClass;
}

/** Schedules an occurrence. When a seated TicketClass exists on the
 *  listing, generates its numbered seats for this specific occurrence
 *  in the same transaction — seat 12A on Tuesday's coach and seat 12A
 *  on Wednesday's coach are different rows, independently sellable. */
export async function createSchedule(
  ctx: Ctx,
  listingId: string,
  input: { departAt: Date; arriveAt?: Date; gateInfo?: string; vehicleOrHallLabel?: string },
) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { ticketClasses: true } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'schedule.write');

  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.listingSchedule.create({
      data: {
        listingId, departAt: input.departAt, arriveAt: input.arriveAt,
        gateInfo: input.gateInfo, vehicleOrHallLabel: input.vehicleOrHallLabel,
      },
    });

    // Labels run continuously across every seated class on the
    // schedule, not restarted per class — a real vehicle/hall has one
    // seat map (seat 12 is either economy or business, never both), so
    // two classes both labelling their own seats "1" would collide on
    // the (scheduleId, label) unique constraint and misrepresent the
    // layout besides.
    let nextLabel = 1;
    for (const tc of listing.ticketClasses) {
      if (!tc.seated) continue;
      await tx.seat.createMany({
        data: Array.from({ length: tc.capacity }, (_, i) => ({
          scheduleId: created.id,
          ticketClassId: tc.id,
          label: String(nextLabel + i),
        })),
      });
      nextLabel += tc.capacity;
    }
    return created;
  });

  await recordAudit(ctx, { action: 'schedule.created', targetType: 'listing_schedule', targetId: schedule.id, payload: { listingId } });
  return schedule;
}

// ───────────────────────────── Public reads ────────────────────────

/** Public storefront — no auth required, PUBLISHED listings only.
 *  Never imports Prisma-select fields staff would see (org contact
 *  details are already public on the org profile, no PII risk here —
 *  tickets don't carry buyer PII on the public read path). */
export async function listPublicListings(vertical?: 'EVENTS' | 'TRANSPORT') {
  return prisma.listing.findMany({
    where: { status: 'PUBLISHED', org: { status: 'ACTIVE', ...(vertical ? { vertical } : {}) } },
    include: { org: true, venue: true, route: true, ticketClasses: true, schedules: { where: { status: 'SCHEDULED' }, orderBy: { departAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Public seat map for one schedule+class — what the booking form
 *  renders as pickable seats. Never includes who booked what. */
export async function listAvailableSeats(scheduleId: string, ticketClassId: string) {
  return prisma.seat.findMany({
    where: { scheduleId, ticketClassId, status: 'AVAILABLE' },
    select: { id: true, label: true },
    orderBy: { label: 'asc' },
  });
}

export async function getPublicListing(slug: string) {
  const listing = await prisma.listing.findFirst({
    where: { slug, status: 'PUBLISHED', org: { status: 'ACTIVE' } },
    include: { org: true, venue: true, route: true, ticketClasses: true, schedules: { where: { status: 'SCHEDULED' }, orderBy: { departAt: 'asc' } } },
  });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  return listing;
}

// ───────────────────────────── Bookings ────────────────────────────

export interface BookingLineInput {
  ticketClassId: string;
  /** Required when the class is seated; ignored otherwise. */
  seatId?: string;
  holderName?: string;
  holderMsisdn?: string;
}

export interface CreateBookingInput {
  scheduleId: string;
  buyerName: string;
  buyerMsisdn: string;
  paymentMethod: 'MPESA_STK' | 'CASH';
  lines: BookingLineInput[];
}

/**
 * Books one or more tickets against a schedule. Runs as one
 * transaction: seat claims (AVAILABLE → BOOKED) and general-admission
 * capacity checks both happen inside it, so two buyers racing for the
 * same seat or the last GA slot can't both win. A SUBJECT buys as
 * themselves (buyerPartyId = ctx.partyId); an unauthenticated
 * storefront checkout passes ctx from anonCtx() and buyerPartyId stays
 * null, same as StoreOrder.
 */
export async function createBooking(ctx: Ctx, input: CreateBookingInput) {
  requireCapability(ctx, 'booking.create', { partyId: ctx.partyId });
  if (input.lines.length === 0) throw new TicketingError('Add at least one ticket', 'BAD_INPUT');

  const booking = await prisma.$transaction(async (tx) => {
    const classIds = [...new Set(input.lines.map((l) => l.ticketClassId))];
    const classes = await tx.ticketClass.findMany({ where: { id: { in: classIds } } });
    const classById = new Map(classes.map((c) => [c.id, c]));

    let totalKes = 0;
    const ticketData: {
      ticketClassId: string; seatId: string | null; code: string;
      holderName: string | null; holderMsisdn: string | null; priceKes: number;
    }[] = [];

    for (const line of input.lines) {
      const tc = classById.get(line.ticketClassId);
      if (!tc) throw new TicketingError('Ticket class not found', 'NOT_FOUND');

      if (tc.seated) {
        if (!line.seatId) throw new TicketingError('Choose a seat for this ticket class', 'BAD_INPUT');
        const seat = await tx.seat.findUnique({ where: { id: line.seatId } });
        if (!seat || seat.scheduleId !== input.scheduleId || seat.ticketClassId !== tc.id) {
          throw new TicketingError('Seat not found', 'NOT_FOUND');
        }
        if (seat.status !== 'AVAILABLE') throw new TicketingError('That seat is already taken', 'SEAT_TAKEN');
        await tx.seat.update({ where: { id: seat.id }, data: { status: 'BOOKED' } });
      } else {
        const sold = await tx.ticket.count({
          where: { ticketClassId: tc.id, status: { in: ['VALID', 'USED'] }, booking: { scheduleId: input.scheduleId } },
        });
        if (sold >= tc.capacity) throw new TicketingError('Sold out', 'SOLD_OUT');
      }

      const priceKes = Number(tc.priceKes);
      totalKes += priceKes;
      ticketData.push({
        ticketClassId: tc.id,
        seatId: line.seatId ?? null,
        code: randomBytes(9).toString('base64url'),
        holderName: line.holderName ?? null,
        holderMsisdn: line.holderMsisdn ?? null,
        priceKes,
      });
    }

    const created = await tx.booking.create({
      data: {
        scheduleId: input.scheduleId,
        buyerPartyId: ctx.partyId ?? null,
        buyerName: input.buyerName,
        buyerMsisdn: input.buyerMsisdn,
        paymentMethod: input.paymentMethod,
        totalKes,
        status: input.paymentMethod === 'CASH' ? 'PAID' : 'PENDING_PAYMENT',
        paidAt: input.paymentMethod === 'CASH' ? new Date() : null,
        tickets: { create: ticketData },
      },
      include: { tickets: true },
    });

    return created;
  });

  await recordAudit(ctx, { action: 'booking.created', targetType: 'booking', targetId: booking.id, payload: { scheduleId: input.scheduleId, totalKes: booking.totalKes.toString() } });
  return booking;
}

export async function attachBookingCheckoutRequestId(bookingId: string, checkoutRequestId: string) {
  return prisma.booking.update({ where: { id: bookingId }, data: { mpesaCheckoutRequestId: checkoutRequestId } });
}

/** M-Pesa callback path — no session, mirrors confirmStoreOrderPayment.
 *  Idempotent on mpesaCheckoutRequestId: a booking already PAID is a
 *  no-op, not a double-issue. */
export async function confirmBookingPayment(checkoutRequestId: string) {
  const booking = await prisma.booking.findUnique({ where: { mpesaCheckoutRequestId: checkoutRequestId } });
  if (!booking) throw new TicketingError('Booking not found', 'NOT_FOUND');
  if (booking.status === 'PAID') return booking;

  const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: 'PAID', paidAt: new Date() } });
  await recordAudit(systemCtx('mpesa-callback'), { action: 'booking.paid', targetType: 'booking', targetId: booking.id });
  return updated;
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — same job checkOrderStatus does for store checkout.
 *  Buyer-only: the booking's own buyerPartyId must match ctx.partyId,
 *  same boundary createBooking sets at checkout. */
export async function getBookingStatus(ctx: Ctx, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, buyerPartyId: true, status: true },
  });
  if (!booking || !booking.buyerPartyId || booking.buyerPartyId !== ctx.partyId) {
    throw new TicketingError('Booking not found', 'NOT_FOUND');
  }
  requireCapability(ctx, 'booking.read', { partyId: ctx.partyId });
  return { id: booking.id, status: booking.status };
}

export async function getMyBookings(ctx: Ctx) {
  requireCapability(ctx, 'booking.read', { partyId: ctx.partyId });
  if (!ctx.partyId) return [];
  return prisma.booking.findMany({
    where: { buyerPartyId: ctx.partyId },
    include: { schedule: { include: { listing: { include: { org: true, venue: true, route: true } } } }, tickets: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listOrgBookings(ctx: Ctx, orgId: string) {
  await assertOwnsOrg(ctx, orgId, 'booking.read');
  return prisma.booking.findMany({
    where: { schedule: { listing: { orgId } } },
    include: { schedule: { include: { listing: true } }, tickets: true },
    orderBy: { createdAt: 'desc' },
  });
}

// ───────────────────────────── Check-in ────────────────────────────

/** The gate scanner. `staffId` is the TicketOrgStaff who scanned —
 *  required so ctx.ticketOrgId can't be the only thing on record when
 *  a ticket gets marked USED. */
export async function checkInTicket(ctx: Ctx, orgId: string, code: string) {
  await assertOwnsOrg(ctx, orgId, 'ticket.checkin');

  const ticket = await prisma.ticket.findUnique({
    where: { code },
    include: { booking: { include: { schedule: { include: { listing: true } } } } },
  });
  if (!ticket || ticket.booking.schedule.listing.orgId !== orgId) {
    throw new TicketingError('Ticket not found for this organiser', 'NOT_FOUND');
  }
  if (ticket.status === 'USED') throw new TicketingError('Already checked in', 'BAD_INPUT');
  if (ticket.status !== 'VALID') throw new TicketingError('Ticket is not valid', 'BAD_INPUT');

  const staffId = ctx.actorType === 'AGENT' ? ctx.actorId : null;
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'USED', checkedInAt: new Date(), checkedInById: staffId },
  });
  await recordAudit(ctx, { action: 'ticket.checked_in', targetType: 'ticket', targetId: ticket.id, payload: { orgId } });
  return updated;
}

export async function cancelBooking(ctx: Ctx, bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { tickets: true, schedule: true } });
  if (!booking) throw new TicketingError('Booking not found', 'NOT_FOUND');

  // Buyer cancelling their own booking, or org staff cancelling one on
  // their organiser's schedule — same two-caller shape as assertOwnsOrg.
  if (booking.buyerPartyId && booking.buyerPartyId === ctx.partyId) {
    requireCapability(ctx, 'booking.cancel', { partyId: ctx.partyId });
  } else {
    const listing = await prisma.listing.findUnique({ where: { id: booking.schedule.listingId } });
    await assertOwnsOrg(ctx, listing!.orgId, 'booking.cancel');
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    await tx.ticket.updateMany({ where: { bookingId }, data: { status: 'CANCELLED' } });
    const seatIds = booking.tickets.map((t) => t.seatId).filter((id): id is string => Boolean(id));
    if (seatIds.length) await tx.seat.updateMany({ where: { id: { in: seatIds } }, data: { status: 'AVAILABLE' } });
  });

  await recordAudit(ctx, { action: 'booking.cancelled', targetType: 'booking', targetId: bookingId });
  return { id: bookingId, status: 'CANCELLED' as const };
}
