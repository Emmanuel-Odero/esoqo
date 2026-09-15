import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * One-time data touch-up, not a schema migration — run once after the
 * completeRegistration fix in dal/registration.ts ships (that fix only
 * changes behaviour for registrations completed from now on; it can't
 * retroactively fix rows that already completed under the old code).
 *
 * Before that fix, a COMPLETE registration that founded a brand-new
 * group or business never had groupPartyId/bizPartyId written back —
 * only the "joined an existing org via search" path did. This finds
 * each such row's Organisation the same way a human would: the founding
 * person's own Membership to an org with the matching name — and links it.
 *
 * Idempotent: only touches rows where the link is still null.
 * Run with: pnpm --filter @esoqo/db backfill:registration-org-links
 */
async function main() {
  const orphanedGroups = await prisma.registration.findMany({
    where: { joiningAs: 'group', status: 'COMPLETE', groupPartyId: null, orgName: { not: null }, partyId: { not: null } },
  });
  const orphanedBiz = await prisma.registration.findMany({
    where: { joiningAs: 'biz', status: 'COMPLETE', bizPartyId: null, bizName: { not: null }, partyId: { not: null } },
  });

  let linked = 0, unmatched = 0;

  for (const reg of orphanedGroups) {
    const membership = await prisma.membership.findFirst({
      where: { personId: reg.partyId!, org: { officialName: reg.orgName! } },
      select: { orgId: true },
    });
    if (!membership) { console.log(`no match — registration ${reg.id} ("${reg.orgName}")`); unmatched++; continue; }
    await prisma.registration.update({ where: { id: reg.id }, data: { groupPartyId: membership.orgId } });
    console.log(`linked group registration ${reg.id} -> org ${membership.orgId} ("${reg.orgName}")`);
    linked++;
  }

  for (const reg of orphanedBiz) {
    const membership = await prisma.membership.findFirst({
      where: { personId: reg.partyId!, org: { officialName: reg.bizName! } },
      select: { orgId: true },
    });
    if (!membership) { console.log(`no match — registration ${reg.id} ("${reg.bizName}")`); unmatched++; continue; }
    await prisma.registration.update({ where: { id: reg.id }, data: { bizPartyId: membership.orgId } });
    console.log(`linked business registration ${reg.id} -> org ${membership.orgId} ("${reg.bizName}")`);
    linked++;
  }

  console.log(`done — ${linked} linked, ${unmatched} unmatched (needs a human look)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
