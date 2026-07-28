import { prisma } from '../client';
import { requireCapability, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';

export async function getParty(ctx: Ctx, partyId: string) {
  requireCapability(ctx, 'party.read', { partyId });
  return prisma.party.findUnique({
    where: { id: partyId, deletedAt: null },
    include: {
      person: true,
      organisation: true,
      enterprises: true,
      attestations: { where: { revokedAt: null }, orderBy: { issuedAt: 'desc' } },
      memberships: { include: { org: { include: { party: true } } } },
    },
  });
}

export async function getPartyByMsisdn(ctx: Ctx, msisdn: string) {
  requireCapability(ctx, 'party.read');
  const person = await prisma.person.findUnique({
    where: { msisdn },
    include: { party: { include: { enterprises: true } } },
  });
  return person?.party ?? null;
}

export interface ListPartiesFilter {
  county?: string;
  kind?: 'PERSON' | 'ORGANISATION';
  segment?: string;
  search?: string;
  take?: number;
  skip?: number;
}

export async function listParties(ctx: Ctx, f: ListPartiesFilter = {}) {
  requireCapability(ctx, 'party.read', { county: f.county });

  const where = {
    deletedAt: null,
    ...(f.county ? { county: f.county } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.segment ? { enterprises: { some: { segment: f.segment } } } : {}),
    ...(f.search
      ? {
          OR: [
            { person: { officialName: { contains: f.search, mode: 'insensitive' as const } } },
            { person: { knownAs: { contains: f.search, mode: 'insensitive' as const } } },
            { organisation: { officialName: { contains: f.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.party.findMany({
      where,
      include: { person: true, organisation: true, enterprises: true },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 25,
      skip: f.skip ?? 0,
    }),
    prisma.party.count({ where }),
  ]);
  return { rows, total };
}

/**
 * DPA erasure. Soft-deletes the party and scrubs direct identifiers,
 * keeping the audit chain intact — the chain is a legal record and
 * breaking it to satisfy an erasure request would be a worse failure.
 */
export async function erasePartyData(ctx: Ctx, partyId: string, reason: string) {
  requireCapability(ctx, 'party.erase', { partyId });

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.person.updateMany({
      where: { partyId },
      data: {
        officialName: '[erased]',
        knownAs: null,
        email: null,
        nationalIdHash: null,
        msisdn: `erased:${partyId}`,
      },
    });
    await tx.party.update({ where: { id: partyId }, data: { deletedAt: now } });
    await recordAudit(
      ctx,
      { action: 'party.erased', targetType: 'party', targetId: partyId, payload: { reason } },
      tx as never,
    );
    return { erasedAt: now };
  });
}
