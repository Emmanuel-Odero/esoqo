/**
 * Runs backfillBusinessEsoqoPaymentIds once, then reports what the
 * /pay page can now actually resolve.
 *
 * Businesses registered before completeRegistration started minting a
 * Payment ID have a registered business and no way to be paid. This
 * gives them one. Safe to re-run: organisations that already have an ID
 * are skipped.
 *
 *   npx tsx scripts/backfill-business-ids.ts
 */
import { prisma } from '../src/client';
import { systemCtx } from '../src/capabilities';
import { backfillBusinessEsoqoPaymentIds } from '../src/dal/payment-id';
import { findPayableBusinesses } from '../src/dal/business-payment';

async function main() {
  const issued = await backfillBusinessEsoqoPaymentIds(systemCtx('backfill-business-ids'));
  console.log(`issued ${issued.length} business Payment ID(s):`);
  for (const row of issued) console.log(`  ${row.code}  ${row.name}`);

  const payable = await prisma.party.findMany({
    where: { kind: 'ORGANISATION', deletedAt: null, esoqoPaymentId: { is: { suspendedAt: null } } },
    select: { esoqoPaymentId: { select: { code: true } }, organisation: { select: { officialName: true, knownAs: true } } },
  });
  console.log(`\npayable businesses now: ${payable.length}`);
  for (const p of payable) {
    const code = p.esoqoPaymentId!.code;
    const found = await findPayableBusinesses(systemCtx('backfill-business-ids'), code);
    console.log(`  ${code} -> ${found.length === 1 ? `OK  ${found[0]!.name}` : `BROKEN (${found.length} matches)`}`);
  }
  await prisma.$disconnect();
}
main();
