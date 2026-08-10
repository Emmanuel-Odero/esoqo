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
  ip?: string | null;
  /**
   * Marks a Ctx built by @esoko/auth from a verified session.
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
            'cashier.write:own', 'shift.write:own', 'receipt.write:own'],

  FIELD_AGENT: ['registration.create', 'registration.read:agent=self',
                'attestation.issue:FIELD_VISIT', 'party.read:county'],

  CECF_OFFICER: ['registration.read', 'party.read', 'attestation.issue:FIELD_VISIT',
                 'attestation.issue:MEDIATION_TRAINED', 'report.read', 'cohort.manage'],

  VIEWER: ['registration.read', 'party.read', 'report.read', 'document.read', 'payment.read'],

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
              'product.moderate', 'pricing.read', 'pricing.write'],

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
