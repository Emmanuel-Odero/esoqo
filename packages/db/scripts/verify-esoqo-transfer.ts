/**
 * End-to-end check of dal/esoqo-transfer.ts against the real dev database:
 * handle/msisdn resolution, the balanced ledger entry, the self-payment
 * and insufficient-balance refusals.
 *
 * Creates and destroys its own two throwaway people, so it is safe to
 * re-run. Not for CI.
 *
 *   npx tsx scripts/verify-esoqo-transfer.ts
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/client';
import { ROLE_PRESETS, type Ctx } from '../src/capabilities';
import { resolveTransferTarget, createEsoqoTransfer, EsoqoTransferError } from '../src/dal/esoqo-transfer';
import { getWalletBalance } from '../src/dal/subject';

const TAG = `verify-transfer-${Date.now()}`;

/** A real SUBJECT ctx, same shape @esoqo/auth builds from a verified
 *  session — constructed directly here since this script has no session
 *  to sign in with. */
function subjectCtxFor(partyId: string): Ctx {
  return { actorType: 'SUBJECT', actorId: partyId, partyId, capabilities: [...ROLE_PRESETS.SUBJECT], __verified: true };
}

async function makePerson(label: string, msisdn: string, handle: string) {
  const partyId = randomUUID();
  await prisma.party.create({ data: { id: partyId, kind: 'PERSON', county: 'Nairobi' } });
  await prisma.person.create({
    data: { partyId, officialName: `${TAG} ${label}`, firstName: TAG, surname: label, msisdn },
  });
  await prisma.esoqoPaymentId.create({ data: { partyId, code: handle } });
  return partyId;
}

async function fundWallet(partyId: string, amountKes: number) {
  const account = await prisma.account.create({ data: { partyId, kind: 'WALLET', currency: 'KES' } });
  const settlement = (await prisma.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } }))
    ?? await prisma.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  await prisma.journalEntry.create({
    data: {
      reference: `${TAG}-fund-${partyId}`,
      description: 'test funding',
      postings: { create: [{ accountId: account.id, amount: amountKes }, { accountId: settlement.id, amount: -amountKes }] },
    },
  });
}

async function cleanup(partyIds: string[]) {
  await prisma.esoqoTransfer.deleteMany({ where: { OR: [{ senderPartyId: { in: partyIds } }, { receiverPartyId: { in: partyIds } }] } });
  const accounts = await prisma.account.findMany({ where: { partyId: { in: partyIds } } });
  const accountIds = accounts.map((a) => a.id);
  const postings = await prisma.posting.findMany({ where: { accountId: { in: accountIds } }, select: { entryId: true } });
  await prisma.posting.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.journalEntry.deleteMany({ where: { id: { in: [...new Set(postings.map((p) => p.entryId))] } } });
  await prisma.account.deleteMany({ where: { partyId: { in: partyIds } } });
  await prisma.esoqoPaymentId.deleteMany({ where: { partyId: { in: partyIds } } });
  await prisma.person.deleteMany({ where: { partyId: { in: partyIds } } });
  await prisma.party.deleteMany({ where: { id: { in: partyIds } } });
}

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ok — ${msg}`);
}

async function main() {
  const senderId = await makePerson('Sender', '+254700000001', `sender${Date.now()}`.toLowerCase());
  const receiverId = await makePerson('Receiver', '+254700000002', `receiver${Date.now()}`.toLowerCase());
  await fundWallet(senderId, 1000);

  try {
    console.log('resolveTransferTarget by msisdn');
    const target = await resolveTransferTarget('+254700000002');
    ok(target?.partyId === receiverId, 'resolves the receiver by msisdn');

    console.log('createEsoqoTransfer happy path');
    const ctx = subjectCtxFor(senderId);
    const { transfer, notify } = await createEsoqoTransfer(ctx, { toIdentifier: '+254700000002', amountKes: 300, note: 'test' });
    ok(Number(transfer.amountKes) === 300, 'transfer amount recorded');
    ok(notify.receiverMsisdns.includes('+254700000002'), 'receiver msisdn included in notify');

    const senderBalance = await getWalletBalance(ctx);
    ok(senderBalance === 700, `sender balance debited (was 1000, got ${senderBalance})`);
    const receiverBalance = await getWalletBalance(subjectCtxFor(receiverId));
    ok(receiverBalance === 300, `receiver balance credited (got ${receiverBalance})`);

    console.log('self-payment is refused');
    try {
      await createEsoqoTransfer(ctx, { toIdentifier: '+254700000001', amountKes: 10 });
      throw new Error('FAILED: self-payment should have thrown');
    } catch (e) {
      ok(e instanceof EsoqoTransferError && e.code === 'CANNOT_PAY_SELF', 'refused with CANNOT_PAY_SELF');
    }

    console.log('over-balance is refused');
    try {
      await createEsoqoTransfer(ctx, { toIdentifier: '+254700000002', amountKes: 100000 });
      throw new Error('FAILED: over-balance should have thrown');
    } catch (e) {
      ok(e instanceof EsoqoTransferError && e.code === 'INSUFFICIENT_BALANCE', 'refused with INSUFFICIENT_BALANCE');
    }

    console.log('\nAll checks passed.');
  } finally {
    await cleanup([senderId, receiverId]);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
