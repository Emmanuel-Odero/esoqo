/**
 * Which kinds of organisation the pay hub can be pointed at, and which
 * of them are groups.
 *
 * This exists because ORG_KINDS in registration.ts is a *join* list and
 * a *pay* list are not the same set, and the Prisma enum has outgrown
 * both. The enum gained SUPPLIER, WHOLESALER, WAREHOUSE and MALL; they
 * were never added to ORG_KINDS, which is correct — nobody joins a
 * warehouse — so nothing should be "fixed" by adding them there. They
 * just need somewhere to be listed as payable, and this is it.
 *
 * So the rule is: every Prisma OrgKind appears in exactly one place
 * here. Nothing is payable-but-unlisted, and a kind added to the schema
 * is caught by the drift test rather than silently becoming unpayable.
 */

/** Everything /pay will accept. Mirrors the Prisma OrgKind enum. */
export const PAYABLE_ORG_KINDS = [
  'CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'WELFARE_GROUP', 'CBO', 'FBO',
  'COOPERATIVE', 'SACCO', 'NGO', 'BUSINESS', 'SCHOOL', 'CLINIC',
  'MARKET_ASSOCIATION', 'SUPPLIER', 'WHOLESALER', 'WAREHOUSE', 'MALL',
  'OTHER',
] as const;
export type PayableOrgKind = (typeof PAYABLE_ORG_KINDS)[number];

/**
 * The ones a person means by "a group" — a savings group, an association,
 * a co-operative. This is what /pay/group searches, and it is
 * deliberately narrower than the full payable set: a driver who opens
 * "Pay a group" and is offered a warehouse has been sent to the wrong
 * page, and being offered a market trader has not.
 *
 * MALL and WAREHOUSE are absent for the same reason they are absent from
 * JAMII_ORG_KINDS: they are places, not groups, whoever owns them.
 */
export const GROUP_ORG_KINDS = [
  'CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'WELFARE_GROUP', 'CBO',
  'FBO', 'COOPERATIVE', 'SACCO', 'NGO', 'MARKET_ASSOCIATION',
] as const;
export type GroupOrgKind = (typeof GROUP_ORG_KINDS)[number];

export function isGroupKind(kind: string): kind is GroupOrgKind {
  return (GROUP_ORG_KINDS as readonly string[]).includes(kind);
}

/** The word to put on a button, a badge and a receipt. Falls back to the
 *  raw key rather than showing nothing, so a kind added to the schema
 *  without a label is ugly rather than invisible. */
export const ORG_KIND_LABELS: Record<string, string> = {
  CHAMA: 'Chama',
  SELF_HELP_GROUP: 'Self-help group',
  TABLE_BANKING: 'Table-banking group',
  WELFARE_GROUP: 'Welfare group',
  CBO: 'Community-based organisation',
  FBO: 'Faith-based organisation',
  COOPERATIVE: 'Co-operative',
  SACCO: 'SACCO',
  NGO: 'NGO',
  BUSINESS: 'Business',
  SCHOOL: 'School',
  CLINIC: 'Clinic',
  MARKET_ASSOCIATION: 'Market association',
  SUPPLIER: 'Supplier',
  WHOLESALER: 'Wholesaler',
  WAREHOUSE: 'Warehouse',
  MALL: 'Mall',
  OTHER: 'Organisation',
};

export function orgKindLabel(kind: string): string {
  return ORG_KIND_LABELS[kind] ?? kind;
}
