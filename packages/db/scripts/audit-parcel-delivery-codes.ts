/**
 * Read-only audit of the parcel delivery-code column.
 *
 * The unique index added in 20261001130000_parcel_delivery_code_unique
 * rewrote whatever duplicates it found. On dev that was 21 pairs the
 * showcase seed had been producing, all of them safe to re-issue. On
 * production it is unknown, because production has never been inspected —
 * and the migration re-issues by a rule that decides whose code matters
 * (closed parcels keep theirs), which is a judgement about real
 * credentials that deserves to be made from evidence rather than
 * assumed.
 *
 * This prints what that evidence is. It writes nothing and deletes
 * nothing; run it against production before the migration is deployed
 * there, and the "what the migration will do" section below is the list
 * to read before letting it.
 *
 *   npx tsx scripts/audit-parcel-delivery-codes.ts
 */
import { prisma } from '../src/client';

/**
 * Mirrors the migration's survivor rule exactly. If one side changes,
 * the audit stops predicting what the deploy will do, which is the
 * whole value of the prediction.
 */
const CLOSED_STATUSES = ['DELIVERED', 'RETURNED_TO_SENDER'] as const;

type DuplicateGroup = {
  deliveryCode: string;
  parcels: { code: string; status: string; createdAt: Date }[];
};

async function main() {
  console.log('== duplicate delivery codes ==');

  const groups = await prisma.$queryRaw<DuplicateGroup[]>`
    SELECT p."deliveryCode",
           json_agg(json_build_object(
             'code', p.code,
             'status', p.status::text,
             'createdAt', p."createdAt"
           ) ORDER BY p.code) AS parcels
    FROM parcel p
    WHERE p."deliveryCode" IS NOT NULL
    GROUP BY p."deliveryCode"
    HAVING count(*) > 1
    ORDER BY p."deliveryCode"
  `;

  const totalParcels = await prisma.parcel.count();
  console.log(`parcels: ${totalParcels}`);
  console.log(`duplicate codes: ${groups.length}`);

  if (groups.length === 0) {
    console.log('\nnothing to re-issue — the index can be deployed as-is');
    return;
  }

  // The rule, stated in the order it matters. A closed parcel's code is
  // evidence a receiver already used; an open parcel's is a label that
  // can change freely.
  let reissues = 0;
  let closedRewrites = 0;

  console.log('\n== what the migration will do ==');
  for (const g of groups) {
    const survivors = [...g.parcels].sort((a, b) => {
      const aClosed = (CLOSED_STATUSES as readonly string[]).includes(a.status) ? 0 : 1;
      const bClosed = (CLOSED_STATUSES as readonly string[]).includes(b.status) ? 0 : 1;
      return aClosed - bClosed || a.code.localeCompare(b.code);
    });
    const survivor = survivors[0]!;
    const reissued = survivors.slice(1);

    console.log(`\n  ${g.deliveryCode}`);
    console.log(`    keeps its code:  ${survivor.code}  (${survivor.status})`);
    for (const r of reissued) {
      reissues++;
      const isClosed = (CLOSED_STATUSES as readonly string[]).includes(r.status);
      if (isClosed) closedRewrites++;
      console.log(`    re-issued:        ${r.code}  (${r.status})${isClosed ? '  <-- CLOSED, credential already used' : ''}`);
    }
  }

  console.log(`\ntotal re-issues: ${reissues}`);
  console.log(`of which on closed parcels: ${closedRewrites}`);

  if (closedRewrites > 0) {
    console.log(
      '\nA closed parcel losing its code means a code a receiver already read\n' +
      'stops matching what they used. The survivor rule should keep those rows,\n' +
      'but if any appear above, stop and check the data before deploying.',
    );
  } else {
    console.log('\nno closed parcel is scheduled to lose its code — safe to deploy');
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });