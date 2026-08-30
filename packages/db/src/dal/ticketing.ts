import type { Prisma } from '@prisma/client';
import { prisma } from '../client';
import { requireCapability, AuthorisationError, systemCtx, type Capability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import { randomBytes } from 'node:crypto';
import { INSTALLMENT_MIN_LEAD_HOURS, MIN_INSTALLMENT_KES, minDepositKes } from '@esoko/domain';
import { findOrCreateTicketCustomer, earnLoyaltyForBooking, getTicketCustomerPoints } from './ticket-customer';

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
    public readonly code:
      | 'NOT_FOUND' | 'SLUG_TAKEN' | 'NOT_YOUR_ENTERPRISE' | 'BAD_INPUT' | 'SOLD_OUT' | 'SEAT_TAKEN'
      | 'PLAN_NOT_ALLOWED' | 'DEPOSIT_TOO_LOW' | 'PAST_DUE' | 'OVERPAY',
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

export interface TicketOrgDirectoryFilter {
  status?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  vertical?: 'EVENTS' | 'TRANSPORT';
  search?: string;
  take?: number;
  skip?: number;
}

/** The staff-facing directory of every organiser platform-wide — the
 *  ticketing counterpart to listStoresForStaff in dal/store.ts. Unlike
 *  listMyTicketOrgs (scoped to ctx.partyId), this is deliberately
 *  unscoped: staff.read/ticketorg.read is a global grant. */
export async function listTicketOrgsForStaff(ctx: Ctx, f: TicketOrgDirectoryFilter = {}) {
  requireCapability(ctx, 'ticketorg.read');
  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.vertical ? { vertical: f.vertical } : {}),
    ...(f.search ? { name: { contains: f.search, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.ticketOrg.findMany({
      where,
      include: {
        enterprise: { include: { party: { include: { person: true, organisation: true } } } },
        _count: { select: { staff: true, listings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 25,
      skip: f.skip ?? 0,
    }),
    prisma.ticketOrg.count({ where }),
  ]);
  return { rows, total };
}

/** Platform-wide counts, unaffected by the directory's current filter. */
export async function getTicketOrgCounts(ctx: Ctx) {
  requireCapability(ctx, 'ticketorg.read');
  const [total, active, transport] = await Promise.all([
    prisma.ticketOrg.count(),
    prisma.ticketOrg.count({ where: { status: 'ACTIVE' } }),
    prisma.ticketOrg.count({ where: { vertical: 'TRANSPORT' } }),
  ]);
  return { total, active, transport, events: total - transport };
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
      addons: { orderBy: { createdAt: 'asc' } },
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
  /** Fixed perk tags — "WIFI", "SNACKS", "CHARGING", "RECLINING",
   *  "EXTRA_LEGROOM", "BLANKET". See AMENITY_TAGS in domain. */
  amenities?: string[];
  amenityNote?: string;
}

export async function createTicketClass(ctx: Ctx, listingId: string, input: CreateTicketClassInput) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'ticketclass.write');
  if (input.capacity < 1) throw new TicketingError('Capacity must be at least 1', 'BAD_INPUT');

  const ticketClass = await prisma.ticketClass.create({
    data: {
      listingId, name: input.name, priceKes: input.priceKes, capacity: input.capacity, seated: input.seated ?? false,
      amenities: input.amenities ?? [], amenityNote: input.amenityNote?.trim() || null,
    },
  });
  await recordAudit(ctx, { action: 'ticketclass.created', targetType: 'ticket_class', targetId: ticketClass.id, payload: { listingId } });
  return ticketClass;
}

/** Schedules an occurrence. When a seated TicketClass exists on the
 *  listing, generates its numbered seats for this specific occurrence
 *  in the same transaction — seat 12A on Tuesday's coach and seat 12A
 *  on Wednesday's coach are different rows, independently sellable.
 *
 *  A listing with a saved SeatMap (see dal/seat-map.ts) generates seats
 *  from that template — same labels, same class assignment, every
 *  time. A listing with no SeatMap falls back to the old plain
 *  sequential numbering below, so a listing built before seat maps
 *  existed (or one that never needs a visual layout, e.g. theatre GA)
 *  keeps working unchanged. */
export async function createSchedule(
  ctx: Ctx,
  listingId: string,
  input: { departAt: Date; arriveAt?: Date; gateInfo?: string; vehicleOrHallLabel?: string },
) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { ticketClasses: true, seatMap: { include: { seats: true } } },
  });
  if (!listing) throw new TicketingError('Listing not found', 'NOT_FOUND');
  await assertOwnsOrg(ctx, listing.orgId, 'schedule.write');

  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.listingSchedule.create({
      data: {
        listingId, departAt: input.departAt, arriveAt: input.arriveAt,
        gateInfo: input.gateInfo, vehicleOrHallLabel: input.vehicleOrHallLabel,
      },
    });

    if (listing.seatMap && listing.seatMap.seats.length > 0) {
      await tx.seat.createMany({
        data: listing.seatMap.seats.map((s) => ({
          scheduleId: created.id, ticketClassId: s.ticketClassId, label: s.label,
        })),
      });
      return created;
    }

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

/** Every seat for one schedule, across every class, AVAILABLE or
 *  BOOKED — what the public booking page's visual seat picker renders
 *  (grey out what's taken, same as any airline/bus seat map). Still
 *  never includes who booked it, only that it's taken. */
export async function listScheduleSeats(scheduleId: string) {
  return prisma.seat.findMany({
    where: { scheduleId },
    select: { id: true, label: true, status: true, ticketClassId: true },
    orderBy: { label: 'asc' },
  });
}

export async function getPublicListing(slug: string) {
  const listing = await prisma.listing.findFirst({
    where: { slug, status: 'PUBLISHED', org: { status: 'ACTIVE' } },
    include: {
      org: true, venue: true, route: true, ticketClasses: true,
      schedules: { where: { status: 'SCHEDULED' }, orderBy: { departAt: 'asc' } },
      seatMap: { include: { seats: { select: { label: true, ticketClassId: true } } } },
      addons: { where: { active: true }, orderBy: { createdAt: 'asc' } },
    },
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
  /** Paid extras for this one ticket — "WiFi", "Snacks", "Lunch" — see
   *  dal/addon.ts. Optional; a buyer can book with none. */
  addonIds?: string[];
}

export interface CreateBookingInput {
  scheduleId: string;
  buyerName: string;
  buyerMsisdn: string;
  /** Optional — a guest checkout can leave this out. Used for ticket
   *  issuance/notification alongside SMS. */
  buyerEmail?: string;
  paymentMethod: 'MPESA_STK' | 'CASH';
  lines: BookingLineInput[];
  /** Omitted = pay in full now. `INSTALLMENT` opens a "lipia pole pole"
   *  plan: a deposit now, the balance in M-Pesa top-ups before
   *  departure. Only for MPESA_STK, future-dated trips, general-
   *  admission classes, and organisers with installmentsEnabled. */
  payment?: { plan: 'FULL' | 'INSTALLMENT'; depositKes?: number };
}

export interface OpenInstallmentPlanResult {
  bookingId: string;
  status: 'PENDING_PAYMENT';
  totalKes: number;
  /** The opening payment the caller must now trigger an STK push for. */
  depositPayment: { id: string; amountKes: number };
  balanceDueBy: Date;
}

/**
 * Books one or more tickets against a schedule. Runs as one
 * transaction: seat claims (AVAILABLE → BOOKED) and general-admission
 * capacity checks both happen inside it, so two buyers racing for the
 * same seat or the last GA slot can't both win. A SUBJECT buys as
 * themselves (buyerPartyId = ctx.partyId); an unauthenticated public
 * checkout passes ctx from anonCtx() and buyerPartyId stays null —
 * same as createStoreOrder, and for the same reason: no capability
 * check gates this, a buyer need not be a registered Esoko subject.
 * Either way, buyerName/buyerMsisdn(/buyerEmail) auto-capture a
 * TicketCustomer so points and ticket delivery work the same whether
 * the buyer signed in or not.
 */
export async function createBooking(ctx: Ctx, input: CreateBookingInput) {
  if (input.lines.length === 0) throw new TicketingError('Add at least one ticket', 'BAD_INPUT');

  const schedule = await prisma.listingSchedule.findUnique({
    where: { id: input.scheduleId },
    select: { departAt: true, listing: { select: { id: true, orgId: true } } },
  });
  if (!schedule) throw new TicketingError('Schedule not found', 'NOT_FOUND');
  const orgId = schedule.listing.orgId;
  const listingId = schedule.listing.id;

  const ticketCustomer = await findOrCreateTicketCustomer(orgId, input.buyerMsisdn, input.buyerName, input.buyerEmail);

  if (input.payment?.plan === 'INSTALLMENT') {
    return openInstallmentPlan(ctx, input, {
      scheduleId: input.scheduleId,
      departAt: schedule.departAt,
      orgId,
      ticketCustomerId: ticketCustomer?.id ?? null,
    });
  }

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
        buyerEmail: input.buyerEmail || null,
        ticketCustomerId: ticketCustomer?.id ?? null,
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

  // CASH is already PAID by the time the transaction above commits —
  // earn points now. MPESA_STK earns later, from confirmBookingPayment,
  // once the callback actually lands.
  if (booking.status === 'PAID' && ticketCustomer) {
    await earnLoyaltyForBooking(orgId, ticketCustomer.id, Number(booking.totalKes), booking.id);
  }

  await recordAudit(ctx, { action: 'booking.created', targetType: 'booking', targetId: booking.id, payload: { scheduleId: input.scheduleId, totalKes: booking.totalKes.toString() } });
  return booking;
}

export async function attachBookingCheckoutRequestId(bookingId: string, checkoutRequestId: string) {
  return prisma.booking.update({ where: { id: bookingId }, data: { mpesaCheckoutRequestId: checkoutRequestId } });
}

// ───────────────────── Installment plans ("lipia pole pole") ────────

interface PlannedLine {
  ticketClassId: string;
  holderName?: string | null;
  holderMsisdn?: string | null;
}

/**
 * Opens a "lipia pole pole" plan: books a future general-admission trip
 * now with only a deposit, the balance owed in M-Pesa top-ups before
 * departure. Deliberately claims no seat and no GA slot — per the
 * product decision, nothing is reserved until the balance is fully paid
 * (confirmBookingPayment issues the tickets then, capacity-checking at
 * that moment). The caller triggers the STK push for `depositPayment`.
 */
async function openInstallmentPlan(
  ctx: Ctx,
  input: CreateBookingInput,
  meta: { scheduleId: string; departAt: Date; orgId: string; ticketCustomerId: string | null },
): Promise<OpenInstallmentPlanResult> {
  if (input.paymentMethod !== 'MPESA_STK') {
    throw new TicketingError('Installment plans are paid by M-Pesa', 'PLAN_NOT_ALLOWED');
  }

  const org = await prisma.ticketOrg.findUnique({
    where: { id: meta.orgId },
    select: { installmentsEnabled: true, minDepositPercent: true },
  });
  if (!org?.installmentsEnabled) {
    throw new TicketingError('This organiser does not offer pay-in-portions', 'PLAN_NOT_ALLOWED');
  }

  const leadMs = meta.departAt.getTime() - Date.now();
  if (leadMs < INSTALLMENT_MIN_LEAD_HOURS * 3600_000) {
    throw new TicketingError(
      `Pay-in-portions is only for trips at least ${INSTALLMENT_MIN_LEAD_HOURS} hours away`,
      'PLAN_NOT_ALLOWED',
    );
  }

  const classIds = [...new Set(input.lines.map((l) => l.ticketClassId))];
  const classes = await prisma.ticketClass.findMany({ where: { id: { in: classIds } } });
  const classById = new Map(classes.map((c) => [c.id, c]));

  let totalKes = 0;
  const plannedLines: PlannedLine[] = [];
  for (const line of input.lines) {
    const tc = classById.get(line.ticketClassId);
    if (!tc) throw new TicketingError('Ticket class not found', 'NOT_FOUND');
    if (tc.seated) {
      throw new TicketingError('Pay-in-portions is not available for seated classes yet', 'PLAN_NOT_ALLOWED');
    }
    totalKes += Number(tc.priceKes);
    plannedLines.push({
      ticketClassId: tc.id,
      holderName: line.holderName ?? null,
      holderMsisdn: line.holderMsisdn ?? null,
    });
  }

  const depositKes = Math.round(input.payment?.depositKes ?? 0);
  const minDeposit = minDepositKes(totalKes, org.minDepositPercent);
  if (depositKes < minDeposit) {
    throw new TicketingError(`The first payment must be at least KES ${minDeposit.toLocaleString('en-KE')}`, 'DEPOSIT_TOO_LOW');
  }
  if (depositKes > totalKes) {
    throw new TicketingError('The deposit is more than the trip costs', 'DEPOSIT_TOO_LOW');
  }

  const booking = await prisma.booking.create({
    data: {
      scheduleId: meta.scheduleId,
      buyerPartyId: ctx.partyId ?? null,
      buyerName: input.buyerName,
      buyerMsisdn: input.buyerMsisdn,
      buyerEmail: input.buyerEmail || null,
      ticketCustomerId: meta.ticketCustomerId,
      paymentMethod: 'MPESA_STK',
      totalKes,
      status: 'PENDING_PAYMENT',
      isInstallment: true,
      amountPaidKes: 0,
      balanceDueBy: meta.departAt,
      plannedLines: plannedLines as unknown as Prisma.InputJsonValue,
      payments: { create: { kind: 'DEPOSIT', amountKes: depositKes, status: 'PENDING' } },
    },
    include: { payments: true },
  });

  await recordAudit(ctx, {
    action: 'booking.installment_opened',
    targetType: 'booking',
    targetId: booking.id,
    payload: { scheduleId: meta.scheduleId, totalKes: totalKes.toString(), depositKes: depositKes.toString() },
  });

  return {
    bookingId: booking.id,
    status: 'PENDING_PAYMENT',
    totalKes,
    depositPayment: { id: booking.payments[0]!.id, amountKes: depositKes },
    balanceDueBy: meta.departAt,
  };
}

export async function attachBookingPaymentCheckoutRequestId(paymentId: string, checkoutRequestId: string) {
  return prisma.bookingPayment.update({
    where: { id: paymentId },
    data: { mpesaCheckoutRequestId: checkoutRequestId },
  });
}

/**
 * Records a top-up (or the final balance) against an open installment
 * plan and returns the BookingPayment the caller must trigger an STK
 * push for. Auth mirrors getBookingStatus: a signed-in buyer's booking
 * is buyer-only; a guest booking's id is the secret.
 */
export async function createBookingBalancePayment(ctx: Ctx, bookingId: string, amountKes: number): Promise<{ id: string; amountKes: number; msisdn: string }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, buyerPartyId: true, buyerMsisdn: true, status: true, isInstallment: true, totalKes: true, amountPaidKes: true, balanceDueBy: true },
  });
  if (!booking || !booking.isInstallment) throw new TicketingError('Booking not found', 'NOT_FOUND');
  if (booking.buyerPartyId) {
    if (booking.buyerPartyId !== ctx.partyId) throw new TicketingError('Booking not found', 'NOT_FOUND');
    requireCapability(ctx, 'booking.read', { partyId: ctx.partyId });
  }
  if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'PARTIALLY_PAID') {
    throw new TicketingError('This plan is not open for payment', 'BAD_INPUT');
  }
  if (booking.balanceDueBy && booking.balanceDueBy.getTime() < Date.now()) {
    throw new TicketingError('The payment deadline for this trip has passed', 'PAST_DUE');
  }

  const amount = Math.round(amountKes);
  const remaining = Number(booking.totalKes) - Number(booking.amountPaidKes);
  if (amount > remaining) {
    throw new TicketingError(`Only KES ${remaining.toLocaleString('en-KE')} is left to pay`, 'OVERPAY');
  }
  if (amount < Math.min(MIN_INSTALLMENT_KES, remaining)) {
    throw new TicketingError(`Each payment must be at least KES ${Math.min(MIN_INSTALLMENT_KES, remaining).toLocaleString('en-KE')}`, 'DEPOSIT_TOO_LOW');
  }

  const payment = await prisma.bookingPayment.create({
    data: {
      bookingId: booking.id,
      kind: amount === remaining ? 'BALANCE' : 'INSTALLMENT',
      amountKes: amount,
      status: 'PENDING',
    },
  });
  await recordAudit(ctx, { action: 'booking.installment_payment_started', targetType: 'booking', targetId: booking.id, payload: { amountKes: amount.toString() } });
  return { id: payment.id, amountKes: amount, msisdn: booking.buyerMsisdn };
}

/** Issues the Ticket rows for a fully-paid installment booking, inside
 *  an open transaction. GA capacity is checked here — the only moment it
 *  is, for a "lipia pole pole" booking. Returns false if a class sold
 *  out while the plan was being paid off (caller cancels + refunds). */
async function issuePlannedTickets(
  tx: Prisma.TransactionClient,
  booking: { id: string; scheduleId: string; plannedLines: unknown },
): Promise<boolean> {
  const lines = (booking.plannedLines as PlannedLine[] | null) ?? [];
  if (lines.length === 0) return true;

  const classIds = [...new Set(lines.map((l) => l.ticketClassId))];
  const classes = await tx.ticketClass.findMany({ where: { id: { in: classIds } } });
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Count per class up front, then check the batch against remaining
  // capacity — two tickets of the same class in one booking must both
  // fit.
  const wantByClass = new Map<string, number>();
  for (const l of lines) wantByClass.set(l.ticketClassId, (wantByClass.get(l.ticketClassId) ?? 0) + 1);
  for (const [classId, want] of wantByClass) {
    const tc = classById.get(classId);
    if (!tc) return false;
    const sold = await tx.ticket.count({
      where: { ticketClassId: classId, status: { in: ['VALID', 'USED'] }, booking: { scheduleId: booking.scheduleId } },
    });
    if (sold + want > tc.capacity) return false;
  }

  for (const l of lines) {
    const tc = classById.get(l.ticketClassId)!;
    await tx.ticket.create({
      data: {
        bookingId: booking.id,
        ticketClassId: l.ticketClassId,
        code: randomBytes(9).toString('base64url'),
        holderName: l.holderName ?? null,
        holderMsisdn: l.holderMsisdn ?? null,
        priceKes: Number(tc.priceKes),
      },
    });
  }
  return true;
}

/** M-Pesa callback path — no session, mirrors confirmStoreOrderPayment.
 *  Two shapes land here, told apart by which table owns the
 *  checkoutRequestId:
 *   · a BookingPayment — an installment plan's deposit/top-up/balance.
 *     Rolls the amount into Booking.amountPaidKes; the plan flips to
 *     PARTIALLY_PAID, or to PAID (issuing tickets, earning loyalty) once
 *     the balance is cleared.
 *   · a Booking.mpesaCheckoutRequestId — the plain full-payment path,
 *     unchanged.
 *  Idempotent either way: an already-confirmed payment / already-PAID
 *  booking is a no-op, not a double-issue. */
export async function confirmBookingPayment(checkoutRequestId: string) {
  const payment = await prisma.bookingPayment.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: {
      booking: { include: { schedule: { select: { listing: { select: { orgId: true } } } } } },
    },
  });

  if (payment) {
    if (payment.status === 'CONFIRMED') return payment.booking;
    const { booking } = payment;

    const result = await prisma.$transaction(async (tx) => {
      await tx.bookingPayment.update({
        where: { id: payment.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      const paid = Number(booking.amountPaidKes) + Number(payment.amountKes);
      const cleared = paid >= Number(booking.totalKes);

      if (!cleared) {
        return tx.booking.update({
          where: { id: booking.id },
          data: { amountPaidKes: paid, status: 'PARTIALLY_PAID' },
        });
      }

      const issued = await issuePlannedTickets(tx, {
        id: booking.id, scheduleId: booking.scheduleId, plannedLines: booking.plannedLines,
      });
      return tx.booking.update({
        where: { id: booking.id },
        data: issued
          ? { amountPaidKes: paid, status: 'PAID', paidAt: new Date() }
          : { amountPaidKes: paid, status: 'CANCELLED' },
      });
    });

    if (result.status === 'PAID' && booking.ticketCustomerId) {
      await earnLoyaltyForBooking(booking.schedule.listing.orgId, booking.ticketCustomerId, Number(booking.totalKes), booking.id);
    }
    await recordAudit(systemCtx('mpesa-callback'), {
      action: result.status === 'PAID' ? 'booking.paid'
        : result.status === 'CANCELLED' ? 'booking.installment_soldout'
        : 'booking.installment_payment_confirmed',
      targetType: 'booking',
      targetId: booking.id,
    });
    return result;
  }

  const booking = await prisma.booking.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: { schedule: { select: { listing: { select: { orgId: true } } } } },
  });
  if (!booking) throw new TicketingError('Booking not found', 'NOT_FOUND');
  if (booking.status === 'PAID') return booking;

  const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: 'PAID', paidAt: new Date() } });

  if (booking.ticketCustomerId) {
    await earnLoyaltyForBooking(booking.schedule.listing.orgId, booking.ticketCustomerId, Number(booking.totalKes), booking.id);
  }

  await recordAudit(systemCtx('mpesa-callback'), { action: 'booking.paid', targetType: 'booking', targetId: booking.id });
  return updated;
}

/** Sweeps installment plans whose balance-due deadline (the trip's
 *  departure) has passed with money still owed — cancels them so the
 *  seat count and the buyer's "My tickets" both reflect reality. A
 *  scheduled caller is a follow-up; the function is safe to run
 *  repeatedly. Returns the cancelled bookings for best-effort SMS. */
export async function sweepOverdueInstallmentBookings() {
  const overdue = await prisma.booking.findMany({
    where: {
      isInstallment: true,
      status: { in: ['PENDING_PAYMENT', 'PARTIALLY_PAID'] },
      balanceDueBy: { lt: new Date() },
    },
    select: { id: true, buyerMsisdn: true, buyerName: true, totalKes: true, amountPaidKes: true },
  });
  if (overdue.length === 0) return [];

  await prisma.booking.updateMany({
    where: { id: { in: overdue.map((b) => b.id) } },
    data: { status: 'CANCELLED' },
  });
  for (const b of overdue) {
    await recordAudit(systemCtx('installment-sweep'), { action: 'booking.installment_expired', targetType: 'booking', targetId: b.id });
  }
  return overdue;
}

/** Polled by the checkout waiting screen while a real Daraja callback
 *  is in flight — same job checkOrderStatus does for store checkout.
 *  A signed-in buyer's booking is buyer-only (buyerPartyId must match
 *  ctx.partyId); a guest booking has no partyId to check against, so
 *  the id itself is the secret — same trust model as StoreOrder's
 *  getOrder, which this mirrors. */
export async function getBookingStatus(ctx: Ctx, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, buyerPartyId: true, status: true, ticketCustomerId: true,
      isInstallment: true, totalKes: true, amountPaidKes: true, balanceDueBy: true,
      payments: { select: { amountKes: true, kind: true, status: true, confirmedAt: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!booking) throw new TicketingError('Booking not found', 'NOT_FOUND');
  if (booking.buyerPartyId) {
    if (booking.buyerPartyId !== ctx.partyId) throw new TicketingError('Booking not found', 'NOT_FOUND');
    requireCapability(ctx, 'booking.read', { partyId: ctx.partyId });
  }
  const points = booking.ticketCustomerId ? await getTicketCustomerPoints(booking.ticketCustomerId) : null;
  const totalKes = Number(booking.totalKes);
  const amountPaidKes = Number(booking.amountPaidKes);
  return {
    id: booking.id,
    status: booking.status,
    points,
    isInstallment: booking.isInstallment,
    totalKes,
    amountPaidKes,
    balanceKes: Math.max(0, totalKes - amountPaidKes),
    balanceDueBy: booking.balanceDueBy,
    payments: booking.payments.map((p) => ({
      amountKes: Number(p.amountKes), kind: p.kind, status: p.status, confirmedAt: p.confirmedAt,
    })),
  };
}

/** Public read for the guest balance-payment page (/tickets/booking/
 *  [bookingId]). The booking id is the secret — same trust model as
 *  getBookingStatus for a guest booking. No buyer PII beyond the name
 *  that already prints on the ticket. */
export async function getBookingForBalancePayment(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, status: true, isInstallment: true, buyerName: true, buyerMsisdn: true,
      totalKes: true, amountPaidKes: true, balanceDueBy: true,
      payments: { select: { amountKes: true, kind: true, status: true, confirmedAt: true }, orderBy: { createdAt: 'asc' } },
      schedule: {
        select: {
          departAt: true,
          listing: { select: { title: true, slug: true, venue: { select: { name: true } }, route: { select: { originName: true, destinationName: true } }, org: { select: { name: true } } } },
        },
      },
    },
  });
  if (!booking || !booking.isInstallment) throw new TicketingError('Booking not found', 'NOT_FOUND');
  const totalKes = Number(booking.totalKes);
  const amountPaidKes = Number(booking.amountPaidKes);
  return {
    id: booking.id,
    status: booking.status,
    buyerName: booking.buyerName,
    buyerMsisdn: booking.buyerMsisdn,
    totalKes,
    amountPaidKes,
    balanceKes: Math.max(0, totalKes - amountPaidKes),
    balanceDueBy: booking.balanceDueBy,
    departAt: booking.schedule.departAt,
    listingTitle: booking.schedule.listing.title,
    listingSlug: booking.schedule.listing.slug,
    orgName: booking.schedule.listing.org.name,
    where: booking.schedule.listing.venue?.name
      ?? (booking.schedule.listing.route
        ? `${booking.schedule.listing.route.originName} → ${booking.schedule.listing.route.destinationName}`
        : null),
    payments: booking.payments.map((p) => ({
      amountKes: Number(p.amountKes), kind: p.kind, status: p.status, confirmedAt: p.confirmedAt,
    })),
  };
}

export async function getMyBookings(ctx: Ctx) {
  requireCapability(ctx, 'booking.read', { partyId: ctx.partyId });
  if (!ctx.partyId) return [];
  return prisma.booking.findMany({
    where: { buyerPartyId: ctx.partyId },
    include: {
      schedule: { include: { listing: { include: { org: true, venue: true, route: true } } } },
      tickets: true,
      payments: { orderBy: { createdAt: 'asc' } },
    },
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
