/**
 * One-off: create a signed-in-able test user with a funded WALLET and a
 * SHOPPING voucher, for a manual browser click-through of the wallet UI
 * (top-up/send/withdraw/pay-business). Idempotent on msisdn — re-run
 * safe, just reports the existing party if already created.
 *
 *   npx tsx scripts/verify-ui-smoke-setup.ts
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { prisma } from '../src/client';

const MSISDN = '+254700099001';
const PIN = '135790';

async function main() {
  let person = await prisma.person.findUnique({ where: { msisdn: MSISDN } });
  let partyId: string;

  if (person) {
    partyId = person.partyId;
    console.log('Reusing existing test person', partyId);
  } else {
    partyId = randomUUID();
    await prisma.party.create({ data: { id: partyId, kind: 'PERSON', county: 'Nairobi', sourceSystem: 'ESOKO' } });
    person = await prisma.person.create({
      data: { partyId, officialName: 'UI Smoke Test', firstName: 'UI', surname: 'Smoke', msisdn: MSISDN },
    });
    await prisma.attestation.create({
      data: { subjectId: partyId, claimType: 'MSISDN_VERIFIED', method: 'SELF_DECLARED' },
    });
    console.log('Created test person', partyId);
  }

  const pinHash = await hash(PIN);
  await prisma.userCredential.upsert({
    where: { personId: partyId },
    create: { personId: partyId, pinHash, pinSetAt: new Date() },
    update: { pinHash, pinSetAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });

  const existingId = await prisma.esoqoPaymentId.findUnique({ where: { partyId } });
  if (!existingId) {
    await prisma.esoqoPaymentId.create({ data: { partyId, code: `uismoke${Date.now()}`.toLowerCase() } });
  }

  const account = await prisma.account.findFirst({ where: { partyId, kind: 'WALLET', currency: 'KES' } })
    ?? await prisma.account.create({ data: { partyId, kind: 'WALLET', currency: 'KES' } });
  const settlement = await prisma.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } })
    ?? await prisma.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });

  const balance = await prisma.posting.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
  const current = Number(balance._sum.amount ?? 0);
  const TOPUP = 5000;
  if (current < TOPUP) {
    await prisma.journalEntry.create({
      data: {
        reference: `UI-SMOKE-FUND-${Date.now()}`,
        description: 'UI smoke test funding',
        postings: { create: [{ accountId: account.id, amount: TOPUP - current }, { accountId: settlement.id, amount: -(TOPUP - current) }] },
      },
    });
  }

  const existingVoucher = await prisma.voucherCard.findFirst({ where: { ownerPartyId: partyId, purpose: 'SHOPPING' } });
  if (!existingVoucher) {
    const voucher = await prisma.voucherCard.create({
      data: {
        ownerPartyId: partyId, label: 'Shopping', purpose: 'SHOPPING', status: 'ACTIVE',
        qrToken: randomBytes(8).toString('hex'), shortCode: `VCH-${randomBytes(3).toString('hex').toUpperCase()}`,
      },
    });
    await prisma.voucherLedgerEntry.create({
      data: { voucherId: voucher.id, points: 2000, kesEquiv: 200, kind: 'LOAD_MPESA', refId: 'ui-smoke-seed' },
    });
  }

  const finalBalance = await prisma.posting.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
  console.log('\nSign in at http://localhost:3001/signin with:');
  console.log('  Phone:', MSISDN);
  console.log('  PIN:  ', PIN);
  console.log('  Wallet balance: KES', Number(finalBalance._sum.amount ?? 0));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
