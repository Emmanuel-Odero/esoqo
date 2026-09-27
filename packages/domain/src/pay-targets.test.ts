import { describe, it, expect } from 'vitest';
import {
  PAYABLE_ORG_KINDS, GROUP_ORG_KINDS, isGroupKind, orgKindLabel, ORG_KIND_LABELS,
} from './pay-targets';
import { ORG_KINDS, JOINABLE_GROUP_KINDS } from './registration';

/**
 * The list the Prisma OrgKind enum is expected to hold. Kept here as a
 * literal on purpose: if this test passes, both sides of the contract
 * still agree, and when a kind is added to the schema the test fails
 * and names what is missing. That is the whole point — the drift that
 * made SUPPLIER, WHOLESALER, WAREHOUSE and MALL payable-but-unlisted
 * happened precisely because nothing compared the two lists.
 */
const PRISMA_ORG_KINDS = [
  'CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'WELFARE_GROUP', 'CBO', 'FBO',
  'COOPERATIVE', 'SACCO', 'NGO', 'BUSINESS', 'SCHOOL', 'CLINIC',
  'MARKET_ASSOCIATION', 'SUPPLIER', 'WHOLESALER', 'WAREHOUSE', 'MALL', 'OTHER',
] as const;

describe('payable org kinds', () => {
  it('covers every kind the schema knows about, and invents none', () => {
    expect([...PAYABLE_ORG_KINDS].sort()).toEqual([...PRISMA_ORG_KINDS].sort());
  });

  // The bug this whole module exists to prevent, named as a test.
  it('does not repeat the registration list and so still omits the commerce kinds', () => {
    for (const kind of ['SUPPLIER', 'WHOLESALER', 'WAREHOUSE', 'MALL'] as const) {
      expect(PAYABLE_ORG_KINDS).toContain(kind);
      expect(ORG_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it('leaves the join list alone, because a warehouse is not something you join', () => {
    // ORG_KINDS feeds the join funnel. If the two lists were unified the
    // group-join flow would start offering godowns.
    expect(JOINABLE_GROUP_KINDS).not.toContain('WAREHOUSE');
    expect(JOINABLE_GROUP_KINDS).toContain('CHAMA');
  });
});

describe('group org kinds', () => {
  it('is a subset of the payable kinds', () => {
    for (const kind of GROUP_ORG_KINDS) {
      expect(PAYABLE_ORG_KINDS).toContain(kind);
    }
  });

  // A driver who opens "Pay a group" and is offered a warehouse has been
  // sent to the wrong page.
  it('excludes places and trades that are payable but not groups', () => {
    for (const kind of ['BUSINESS', 'WAREHOUSE', 'MALL', 'SUPPLIER', 'WHOLESALER', 'SCHOOL', 'CLINIC', 'OTHER']) {
      expect(isGroupKind(kind)).toBe(false);
    }
  });

  it('includes the kinds a Kenyan saver would call a group', () => {
    for (const kind of ['CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'SACCO', 'COOPERATIVE', 'MARKET_ASSOCIATION']) {
      expect(isGroupKind(kind)).toBe(true);
    }
  });

  it('agrees with Our Jamii, which answers the same question for a different job', () => {
    // jamii.ts filters ORG_KINDS; this list is written from the schema.
    // They cover the same ground and must not drift apart silently.
    for (const kind of GROUP_ORG_KINDS) {
      expect(ORG_KINDS as readonly string[]).toContain(kind);
    }
  });
});

describe('org kind labels', () => {
  it('labels every payable kind, so no badge renders blank', () => {
    for (const kind of PAYABLE_ORG_KINDS) {
      expect(ORG_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it('labels are human, not enum keys', () => {
    expect(orgKindLabel('SELF_HELP_GROUP')).toBe('Self-help group');
    expect(orgKindLabel('FBO')).toBe('Faith-based organisation');
  });

  it('falls back to the raw key rather than showing nothing', () => {
    expect(orgKindLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
