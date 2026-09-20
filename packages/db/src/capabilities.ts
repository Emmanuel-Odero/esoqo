/**
 * Capabilities — not roles.
 *
 * A role is a preset bundle of capabilities, nothing more. The CECF
 * platform hardcoded nine roles into route tables; every new partner
 * meant a code change. Capabilities are strings, scoped, and granted
 * per organisation, so a new county officer or a new bank's credit
 * analyst is a data change.
 *
 * Format:  <resource>.<action>[:<qualifier>]
 * Examples:
 *   registration.read
 *   registration.read:county=Nairobi
 *   attestation.issue:GROUP_REGISTERED
 *   entity.write:own
 */

export type Capability = string;

export type ActorType = 'SUBJECT' | 'STAFF' | 'AGENT' | 'SYSTEM' | 'ISSUER';

export interface Ctx {
  actorType: ActorType;
  /** Party id for a subject, StaffUser id for staff. */
  actorId: string | null;
  capabilities: Capability[];
  /** Set for SUBJECT contexts. Used by `:own` qualifiers. */
  partyId?: string | null;
  orgId?: string | null;
  /** Set for an AGENT context scoped to one store — a cashier or manager
   *  signed in at the till, not a Party. See assertOwnsStore in dal/store.ts:
   *  authorised by this matching the requested store, not by ownership. */
  storeId?: string | null;
  /** Set for an AGENT context scoped to one ticketing org — a
   *  TicketOrgStaff session (admin/manager/scanner), not a Party. See
   *  AssertOwnsOrg in services/core-go/internal/dbx: same reasoning
   *  as storeId. */
  ticketOrgId?: string | null;
  ip?: string | null;
  /**
   * Marks a Ctx built by @esoqo/auth from a verified session.
   * Never settable from a request header — that is exactly the
   * CVE-2025-29927 shape.
   */
  readonly __verified: true;
}

export class AuthorisationError extends Error {
  readonly status = 403;
  constructor(
    public readonly capability: string,
    public readonly ctx: Pick<Ctx, 'actorType' | 'actorId'>,
  ) {
    super(`Denied: ${capability}`);
    this.name = 'AuthorisationError';
  }
}

/** SYSTEM context — for migrations, workers and seeds only. Never from a request. */
export function systemCtx(reason: string): Ctx {
  if (!reason) throw new Error('systemCtx requires a reason for the audit trail');
  return {
    actorType: 'SYSTEM',
    actorId: `system:${reason}`,
    capabilities: ['*'],
    __verified: true,
  };
}

/** Anonymous context. Has nothing. Public reads only. */
export function anonCtx(ip?: string | null): Ctx {
  return { actorType: 'SYSTEM', actorId: null, capabilities: [], ip, __verified: true };
}

function matches(held: Capability, wanted: Capability, ctx: Ctx, opts?: Record<string, unknown>) {
  if (held === '*') return true;
  if (held === wanted) return true;

  const [hRes, hRest = ''] = held.split('.');
  const [wRes, wRest = ''] = wanted.split('.');
  if (hRes !== wRes) return false;

  const [hAct, hQual] = hRest.split(':');
  const [wAct, wQual] = wRest.split(':');
  if (hAct !== wAct && hAct !== '*') return false;

  // No qualifier held → unrestricted for that action
  if (!hQual) return true;

  if (hQual === 'own') {
    const target = opts?.partyId ?? opts?.subjectId;
    return Boolean(target) && target === ctx.partyId;
  }

  if (hQual.includes('=')) {
    const [k, v] = hQual.split('=');
    if (!k) return false;
    return String(opts?.[k]) === v;
  }

  return hQual === wQual;
}

/**
 * Deny by default. Every DAL function calls this first.
 * If this throws, no query runs.
 */
export function requireCapability(
  ctx: Ctx,
  capability: Capability,
  opts?: Record<string, unknown>,
): void {
  if (!ctx || ctx.__verified !== true) {
    throw new AuthorisationError(capability, { actorType: 'SYSTEM', actorId: null });
  }
  const ok = ctx.capabilities.some((c) => matches(c, capability, ctx, opts));
  if (!ok) throw new AuthorisationError(capability, ctx);
}

export function can(ctx: Ctx, capability: Capability, opts?: Record<string, unknown>): boolean {
  try {
    requireCapability(ctx, capability, opts);
    return true;
  } catch {
    return false;
  }
}

/** Every capability in the system. The admin UI renders from this, so a
 *  new capability appears in the role editor automatically. */
export const CAPABILITY_CATALOGUE = [
  { group: 'Registrations', items: [
    ['registration.read', 'View registrations'],
    ['registration.create', 'Start a registration'],
    ['registration.write', 'Edit a registration'],
    ['registration.void', 'Void a registration'],
    ['registration.export', 'Export registration data'],
  ]},
  { group: 'People & groups', items: [
    ['party.read', 'View people and organisations'],
    ['party.write', 'Edit people and organisations'],
    ['party.pii', 'See unmasked phone numbers and IDs'],
    ['party.erase', 'Erase a record (DPA request)'],
    ['party.credential', 'Assign or reset a login PIN'],
    ['membership.write', 'Add or remove group members'],
  ]},
  { group: 'Documents', items: [
    ['document.read', 'View uploaded documents'],
    ['document.review', 'Accept or reject documents'],
    ['document.delete', 'Delete a document'],
  ]},
  { group: 'Payments', items: [
    ['payment.read', 'View declared payments'],
    ['payment.record', 'Record or amend a payment'],
    ['payment.approve', 'SIGN a payment approval'],
    ['payment.waive', 'Waive a registration fee'],
  ]},
  { group: 'Credentials', items: [
    ['attestation.issue', 'Issue any credential'],
    ['attestation.revoke', 'Revoke a credential'],
  ]},
  { group: 'Oversight', items: [
    ['report.read', 'View reports and analytics'],
    ['audit.read', 'Read the audit log'],
    ['consent.read', 'View consent grants'],
    ['duplicate.review', 'Review probable duplicates'],
  ]},
  { group: 'Administration', items: [
    ['staff.read', 'View staff accounts'],
    ['staff.write', 'Create and edit staff accounts'],
    ['staff.capabilities', 'Grant or revoke capabilities'],
  ]},
  { group: 'Our Jamii', items: [
    ['jamii-interest.read', 'View "not yet a CECF member" interest submissions'],
    ['jamii-interest.write', 'Follow up on and resolve interest submissions'],
    ['jamii-page.read', 'View every Our Jamii community page'],
    ['jamii-page.moderate', 'Publish, suspend or reinstate a community page'],
    ['jamii-domain.moderate', "Suspend, reinstate or remove any group's custom domain"],
    ['jamii-media.manage', 'Curate the platform-wide media-placeholder library (hero/gallery/post patterns)'],
    ['jamii-campaign.read', 'View every crowdfunding campaign'],
    ['jamii-campaign.moderate', 'Cancel or reinstate a campaign'],
    ['jamii-donation.read', 'View donations made platform-wide'],
  ]},
  { group: 'Group treasury', items: [
    ['treasury.read', "View a group's contributions, meetings and withdrawals"],
    ['treasury.contribute', 'Declare a contribution'],
    ['treasury.confirm', "Confirm a member's self-declared contribution"],
    ['treasury.meeting.write', 'Schedule or close a meeting'],
    ['attendance.write', 'Mark attendance, for self or (as an officer) another member'],
    ['treasury.withdraw.request', 'Propose a scheduled withdrawal'],
    ['treasury.withdraw.sign', 'Sign (approve or reject) a proposed withdrawal'],
    ['treasury.policy.write', "Set a group's signer list and treasury policy"],
    ['paymentid.issue', 'Activate an Esoqo Payment ID'],
    ['portfolio.read', "View a member's derived credit-insight snapshot"],
  ]},
  { group: 'Stores & commerce', items: [
    ['store.read', 'View a store'],
    ['store.write', 'Create or edit a store'],
    ['store.moderate', 'Suspend or reinstate any store'],
    ['product.write', 'Add or edit products in a store'],
    ['product.moderate', 'Suspend a product, or comment on it as staff'],
    ['order.read', 'View orders placed on a store'],
    ['order.fulfil', 'Mark an order fulfilled'],
    ['order.reroute', 'Flag or reassign an order to another vendor'],
    ['pos.sell', 'Ring up a PoS sale'],
    ['pricing.read', 'View pricing rules'],
    ['pricing.write', 'Change pricing rules'],
    ['inventory.write', 'Record suppliers and stock purchases'],
    ['customer.read', "View a store's customers and credit book"],
    ['customer.write', 'Add or adjust a customer, credit or loyalty entry'],
    ['cashier.write', 'Add or manage cashier accounts'],
    ['shift.write', 'Open or close a till shift'],
    ['receipt.write', 'Issue a receipt'],
  ]},
  { group: 'Ticketing', items: [
    ['ticketorg.read', 'View a ticketing organiser (event/tour/transport company)'],
    ['ticketorg.write', 'Create or edit a ticketing organiser'],
    ['ticketorg.moderate', 'Suspend or reinstate any ticketing organiser'],
    ['ticketorgstaff.write', 'Add or manage a ticketing organiser’s staff'],
    ['venue.write', 'Add or edit a venue'],
    ['route.write', 'Add or edit a transport route'],
    ['listing.write', 'Create or edit an event or trip listing'],
    ['listing.publish', 'Publish, suspend or cancel a listing'],
    ['ticketclass.write', 'Add or edit a listing’s ticket classes and prices'],
    ['schedule.write', 'Schedule or cancel an occurrence (showtime/departure)'],
    ['booking.read', 'View bookings'],
    ['booking.create', 'Book a ticket'],
    ['booking.cancel', 'Cancel a booking'],
    ['booking.refund', 'Refund a booking'],
    ['ticket.checkin', 'Scan and check in a ticket at the gate'],
  ]},
  { group: 'Fleet & short routes', items: [
    ['fleet.read', 'View vehicles'],
    ['fleet.write', 'Register or ground vehicles'],
    ['crew.read', 'View drivers and conductors'],
    ['crew.write', 'Onboard or deactivate crew'],
    ['trip.read', 'View duty trips'],
    ['trip.write', 'Assign or close duty trips'],
    ['trip.close:own', 'Close a duty trip you are the assigned driver or conductor on'],
    ['vehicle.track', 'See live vehicle positions'],
    ['fare.pay', 'Pay bus fare'],
    ['fare.read', 'View fare payments'],
    ['fare.verify', 'Verify a fare payment (crew)'],
    ['collection.declare', 'Declare cash collected on a trip'],
    ['collection.read', 'View collections and variances'],
    // Passenger luggage. Three, not one: tagging creates a record,
    // claiming releases physical property to a person, and reading the
    // manifest exposes every passenger's name on the vehicle.
    ['luggage.tag', "Tag a passenger's bags onto a trip"],
    ['luggage.claim', 'Hand a tagged bag back to its passenger'],
    ['luggage.read', "View a trip's luggage manifest"],
  ]},
  { group: 'Malls', items: [
    ['mall.read', 'View a mall and its tenant list'],
    ['mall.write', "Manage a mall's tenants"],
  ]},
  { group: 'Warehouses', items: [
    ['warehouse.read', "View a godown's storage agreements and stock"],
    ['warehouse.write', "Manage a godown's storage agreements, stock, and billing"],
  ]},
  { group: 'Parcels', items: [
    ['parcels.read', 'View parcels, including draft/pending-payment bookings'],
    ['parcels.assign', 'Assign a collector and schedule a parcel pickup'],
    ['parcels.cancel', 'Cancel a draft or not-yet-picked-up parcel'],
    ['parcels.refund', "Mark a cancelled parcel's M-Pesa payment as refunded"],
    ['parcels.edit', 'Correct a draft or booked parcel\'s receiver, destination or notes'],
    ['parcels.couriers.manage', 'Onboard, vet, suspend and reinstate parcel couriers'],
    ['parcel_pricing.write', 'Change parcel pricing, zones and bargain rules'],
  ]},
] as const;

export const ALL_CAPABILITIES: Capability[] =
  CAPABILITY_CATALOGUE.flatMap((g) => g.items.map(([c]) => c as Capability));

export function describeCapability(c: Capability): string {
  for (const g of CAPABILITY_CATALOGUE) {
    for (const [key, label] of g.items) if (key === c) return label;
  }
  return c;
}

/**
 * Payment approvals require signatures from DISTINCT approvers.
 *
 * Two is standard dual control. Set to 3 for a stricter regime — the
 * logic in dal/payments.ts reads this, so changing it changes the rule
 * everywhere including the UI copy.
 */
export const PAYMENT_APPROVAL_THRESHOLD =
  Number(process.env.PAYMENT_APPROVAL_THRESHOLD ?? 2);

/** Preset bundles. Convenience only — the model is the capability list. */
export const ROLE_PRESETS = {
  SUBJECT: ['entity.read:own', 'entity.write:own', 'consent.read:own', 'consent.write:own',
            'document.read:own', 'document.write:own', 'wallet.read:own',
            'store.read', 'store.write:own', 'product.write:own',
            'order.read:own', 'order.fulfil:own', 'pos.sell:own',
            'inventory.write:own', 'customer.read:own', 'customer.write:own',
            'cashier.write:own', 'shift.write:own', 'receipt.write:own',
            // Group treasury — the ':own' qualifier only confirms this is a
            // legitimate subject acting as themselves; whether they may act
            // as an officer/signer of the specific group in question is a
            // membership/role lookup done inside dal/treasury.ts, the same
            // way signPaymentApproval checks separation of duties.
            // group.create:own is the one exception — there is no group
            // yet to check membership of, so it just confirms a signed-in
            // person is founding a group as themselves (see createOwnGroup
            // in dal/groups.ts, same self-referential shape as
            // ticketorg.write:own founding a TicketOrg).
            'group.create:own',
            // Self-serve member management — see requireGroupOfficer in
            // dal/groups.ts, which additionally requires the caller to
            // actually be one of orgId's own officers before this
            // ':own' capability does anything.
            'membership.write:own',
            'treasury.read:own', 'treasury.contribute:own', 'treasury.confirm:own',
            'treasury.meeting.write:own', 'attendance.write:own',
            'treasury.withdraw.request:own', 'treasury.withdraw.sign:own',
            'treasury.policy.write:own', 'paymentid.issue:own', 'portfolio.read:own',
            // Ticketing — a subject may open a ticketing org the same way
            // they open a store (own:enterprise), and always books tickets
            // as themselves.
            'ticketorg.read:own', 'ticketorg.write:own', 'ticketorgstaff.write:own', 'venue.write:own',
            'route.write:own', 'listing.write:own', 'listing.publish:own',
            'ticketclass.write:own', 'schedule.write:own',
            'booking.read:own', 'booking.create:own', 'booking.cancel:own',
            'fleet.read:own', 'fleet.write:own', 'crew.read:own', 'crew.write:own',
            'trip.read:own', 'trip.write:own', 'vehicle.track:own',
            'fare.pay:own', 'fare.read:own', 'collection.declare:own', 'collection.read:own',
            // An owner works luggage on their own fleet — a small
            // operator IS the conductor often enough that withholding
            // the write grants would be theatre.
            'luggage.tag:own', 'luggage.claim:own', 'luggage.read:own',
            // Malls — a subject may manage tenants of a mall the same
            // way they manage a store: the ':own' qualifier only checks
            // the caller against the mall Organisation's own partyId
            // (see requireMallOfficer in dal/mall.ts).
            'mall.read', 'mall.write:own',
            // Warehouses (godowns) — same self-serve shape as malls;
            // see requireWarehouseOfficer in dal/warehouse.ts.
            'warehouse.read', 'warehouse.write:own'],

  FIELD_AGENT: ['registration.create', 'registration.read:agent=self',
                'attestation.issue:FIELD_VISIT', 'party.read:county'],

  CECF_OFFICER: ['registration.read', 'party.read', 'attestation.issue:FIELD_VISIT',
                 'attestation.issue:MEDIATION_TRAINED', 'report.read', 'cohort.manage'],

  VIEWER: ['registration.read', 'party.read', 'report.read', 'document.read', 'payment.read',
           'jamii-interest.read', 'jamii-page.read', 'jamii-campaign.read', 'jamii-donation.read'],

  REGISTRAR: ['registration.read', 'registration.create', 'registration.write',
              'party.read', 'party.write', 'party.credential', 'membership.write',
              'document.read', 'document.review',
              'payment.read', 'payment.record', 'report.read'],

  FINANCE_APPROVER: ['registration.read', 'party.read', 'payment.read',
                     'payment.approve', 'document.read', 'report.read', 'audit.read'],

  ESOKO_OPS: ['registration.read', 'registration.write', 'registration.void',
              'registration.export', 'party.read', 'party.write', 'party.pii',
              'party.credential', 'membership.write', 'document.read', 'document.review', 'document.delete',
              'payment.read', 'payment.record', 'audit.read', 'report.read',
              'duplicate.review', 'consent.read', 'staff.read',
              'store.read', 'store.write', 'store.moderate', 'order.read', 'order.reroute',
              'product.moderate', 'pricing.read', 'pricing.write', 'cashier.write',
              'jamii-interest.read', 'jamii-interest.write',
              'jamii-page.read', 'jamii-page.moderate', 'jamii-domain.moderate', 'jamii-media.manage',
              'jamii-campaign.read', 'jamii-campaign.moderate', 'jamii-donation.read',
              'treasury.read', 'treasury.confirm', 'portfolio.read',
              'ticketorg.read', 'ticketorg.moderate', 'ticketorgstaff.write',
              'venue.write', 'route.write', 'listing.write', 'listing.publish',
              'ticketclass.write', 'schedule.write',
              'booking.read', 'booking.cancel', 'booking.refund'],

  SUPER_ADMIN: ['*'],

  ISSUER_MOL: ['attestation.issue:GROUP_REGISTERED', 'registration.read:pending'],
  ISSUER_BRS: ['attestation.issue:BUSINESS_REGISTERED', 'registration.read:pending'],
  ISSUER_KRA: ['attestation.issue:KRA_PIN', 'attestation.issue:ETIMS_ACTIVE'],
  ISSUER_COUNTY: ['attestation.issue:SINGLE_BUSINESS_PERMIT',
                  'attestation.issue:FOOD_HANDLER', 'attestation.issue:HEALTH_CLEARANCE'],

  PARTNER_LENDER: ['portfolio.read:consented', 'application.read', 'application.write'],
} as const satisfies Record<string, readonly Capability[]>;

export type RoleName = keyof typeof ROLE_PRESETS;

/**
 * What a cashier session can do — separate from ROLE_PRESETS because a
 * cashier isn't a Party or a StaffUser, it's a Cashier row scoped to one
 * store (see Ctx.storeId and assertOwnsStore). Unqualified capabilities:
 * the scoping is the ctx.storeId match, not a `:own` qualifier.
 *
 * CASHIER runs the till and nothing else — no products, no settings, no
 * seeing what the shop actually makes. MANAGER is the till plus the
 * operational side a trusted second-in-command needs day to day; still
 * never store.write (theme, name, POS on/off) or cashier.write (they
 * can't create their own replacement or grant themselves more).
 */
export const CASHIER_CAPABILITIES = {
  CASHIER: ['pos.sell', 'shift.write', 'customer.read', 'customer.write', 'receipt.write'],
  MANAGER: ['pos.sell', 'shift.write', 'customer.read', 'customer.write', 'receipt.write',
            'inventory.write', 'product.write', 'order.read', 'order.fulfil', 'store.read'],
} as const satisfies Record<string, readonly Capability[]>;

export type CashierRole = keyof typeof CASHIER_CAPABILITIES;

/**
 * What a TicketOrgStaff session can do — the ticketing-org equivalent
 * of CASHIER_CAPABILITIES. Not a Party, scoped to one org via
 * ctx.ticketOrgId (see AssertOwnsOrg in services/core-go/internal/dbx),
 * same reasoning as ctx.storeId for cashiers.
 *
 * SCANNER — the gate. Nothing but check-in and reading which org
 *           they're signed into (the console shell needs the org's
 *           name — no more sensitive than a cashier already knowing
 *           which store ctx.storeId points at); can't see prices,
 *           names, or bookings beyond "does this code exist".
 * MANAGER — day-to-day running of listings and schedules, sees and
 *           can cancel/refund bookings. Never staff.write or org
 *           settings — can't create their own replacement.
 * ADMIN    — everything, including org.write and staff.write.
 */
export const TICKETING_STAFF_CAPABILITIES = {
  // fare.verify on SCANNER/MANAGER below brings this in line with
  // authsvc.TicketingStaffCapabilities (services/core-go) — it was
  // granted there but never ported back here, a real gap (not just a
  // docs one): a SCANNER/MANAGER/CREW signing in through apps/app's
  // web org-staff flow silently couldn't verify a fare that the same
  // role could verify signing in through mobile. Ported 1:1 per
  // docs/adr/0005-mobile-api-in-go.md; ADMIN's own omission of
  // fare.verify is pre-existing on the Go side too and left as-is here
  // rather than changed unasked.
  SCANNER: ['ticket.checkin', 'ticketorg.read', 'fare.verify', 'fare.read'],
  MANAGER: ['ticket.checkin', 'listing.write', 'listing.publish', 'ticketclass.write',
            'schedule.write', 'venue.write', 'route.write',
            'booking.read', 'booking.cancel', 'booking.refund', 'ticketorg.read',
            'fleet.read', 'crew.read', 'trip.read', 'fare.read', 'fare.verify', 'collection.read', 'vehicle.track',
            'luggage.read', 'luggage.tag', 'luggage.claim'],
  ADMIN:   ['ticket.checkin', 'listing.write', 'listing.publish', 'ticketclass.write',
            'schedule.write', 'venue.write', 'route.write',
            'booking.read', 'booking.cancel', 'booking.refund',
            'ticketorg.read', 'ticketorg.write', 'ticketorgstaff.write',
            'fleet.read', 'fleet.write', 'crew.read', 'crew.write',
            'trip.read', 'trip.write', 'fare.read', 'fare.pay',
            'collection.read', 'collection.declare', 'vehicle.track',
            'luggage.read', 'luggage.tag', 'luggage.claim'],
  // trip.close:own — a CREW login may close only the one trip it's
  // linked to as driver/conductor (TicketOrgStaff.crewMemberId); see
  // dbx.CloseTrip. CREW deliberately still lacks trip.write/trip.read.
  // collection.read: a crew member declaring cash has to be able to
  // see the running tally they're declaring against — same org-wide
  // scope collection.declare already carries for CREW, not a new one.
  // Luggage sits on CREW because the conductor loading bags at a stage
  // is the entire user of the feature — a design needing a manager
  // present to tag a bag is one crews route around with a biro.
  CREW:    ['collection.declare', 'collection.read', 'vehicle.track', 'fare.read', 'fare.verify', 'trip.close:own', 'ticketorg.read',
            'luggage.read', 'luggage.tag', 'luggage.claim'],
} as const satisfies Record<string, readonly Capability[]>;

export type TicketingStaffRole = keyof typeof TICKETING_STAFF_CAPABILITIES;
