/**
 * Starting-point fee bands for WALLET_WITHDRAWAL and THIRDPARTY_PAYOUT —
 * cost-plus over Safaricom's own B2C/send-money tariff, which is what a
 * withdrawal or third-party payout actually costs Esoqo to execute.
 *
 * These numbers are approximate, shaped on the two published data points
 * confirmed at the time this was written (free at/under KES 100; capped at
 * KES 108 for the 20,001–250,000 band) with the bands in between
 * interpolated to follow the same curve. This is a starting point for an
 * operator to correct against Safaricom's actual current business B2C rate
 * card (ask the Safaricom account manager — the public consumer send-money
 * card is not always identical to the negotiated B2C one), NOT a verified
 * production tariff. That correction is a TransactionFeeBand row edit
 * (packages/db/src/dal/fees.ts), never a code change.
 *
 * Idempotent — skips a kind that already has bands, so re-running after an
 * operator has already corrected the numbers does not clobber their edits.
 *
 *   npx tsx prisma/seed-transaction-fees.ts
 */
import { prisma } from '../src/client';

interface Band { minKes: number; maxKes: number; feeKes: number }

const BANDS: Band[] = [
  { minKes: 0, maxKes: 100, feeKes: 0 },
  { minKes: 100.01, maxKes: 500, feeKes: 7 },
  { minKes: 500.01, maxKes: 1_000, feeKes: 13 },
  { minKes: 1_000.01, maxKes: 1_500, feeKes: 23 },
  { minKes: 1_500.01, maxKes: 2_500, feeKes: 33 },
  { minKes: 2_500.01, maxKes: 3_500, feeKes: 53 },
  { minKes: 3_500.01, maxKes: 5_000, feeKes: 57 },
  { minKes: 5_000.01, maxKes: 7_500, feeKes: 78 },
  { minKes: 7_500.01, maxKes: 10_000, feeKes: 90 },
  { minKes: 10_000.01, maxKes: 15_000, feeKes: 100 },
  { minKes: 15_000.01, maxKes: 20_000, feeKes: 105 },
  { minKes: 20_000.01, maxKes: 250_000, feeKes: 108 },
];

async function seedKind(kind: 'WALLET_WITHDRAWAL' | 'THIRDPARTY_PAYOUT') {
  const existing = await prisma.transactionFeeBand.count({ where: { kind } });
  if (existing > 0) {
    console.log(`${kind}: ${existing} band(s) already present — skipping`);
    return;
  }
  await prisma.transactionFeeBand.createMany({
    data: BANDS.map((b) => ({ kind, ...b })),
  });
  console.log(`${kind}: seeded ${BANDS.length} bands`);
}

async function main() {
  await seedKind('WALLET_WITHDRAWAL');
  await seedKind('THIRDPARTY_PAYOUT');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
