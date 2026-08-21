import { prisma } from '../client';
import { requireCapability, systemCtx, type Ctx } from '../capabilities';
import { recordAudit } from '../audit';
import type { DonationStatus, Prisma } from '@prisma/client';

export class DonationError extends Error {
  constructor(msg: string, public readonly code: 'NOT_FOUND' | 'CAMPAIGN_UNAVAILABLE') {
    super(msg);
    this.name = 'DonationError';
  }
}

function receiptCode(): string {
  return `ESK-${(40000 + Math.floor(Math.random() * 9999)).toString()}`;
}

async function findOrCreateSettlementAccount(tx: Prisma.TransactionClient) {
  const existing = await tx.account.findFirst({ where: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
  if (existing) return existing;
  return tx.account.create({ data: { partyId: null, kind: 'SETTLEMENT', currency: 'KES' } });
}

export interface CreateDonationInput {
  campaignId: string;
  donorName: string;
  donorMsisdn: string;
  amountKes: number;
  anonymous: boolean;
}

/**
 * Public giving. No capability — a donor need not be a registered
 * subject; ctx.partyId is attached when they are, exactly like
 * StoreOrder.buyerPartyId.
 */
export async function createDonation(ctx: Ctx, input: CreateDonationInput) {
  const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) throw new DonationError('Campaign not found', 'NOT_FOUND');
  if (campaign.status !== 'ACTIVE') throw new DonationError('This campaign is not accepting donations', 'CAMPAIGN_UNAVAILABLE');
  if (!(input.amountKes > 0)) throw new Error('Enter an amount above zero');

  const donation = await prisma.donation.create({
    data: {
      campaignId: input.campaignId,
      donorPartyId: ctx.partyId ?? null,
      donorName: input.anonymous ? 'Anonymous' : (input.donorName.trim() || 'Anonymous'),
      donorMsisdn: input.donorMsisdn,
      anonymous: input.anonymous,
      amountKes: input.amountKes,
    },
  });

  await recordAudit(ctx, {
    action: 'donation.created', targetType: 'donation', targetId: donation.id,
    payload: { campaignId: input.campaignId, amountKes: input.amountKes },
  });
  return donation;
}

export async function attachDonationCheckoutRequestId(donationId: string, checkoutRequestId: string) {
  return prisma.donation.update({ where: { id: donationId }, data: { mpesaCheckoutRequestId: checkoutRequestId } });
}

/**
 * Called from the M-Pesa callback (or, in console mode, immediately
 * after the push) — idempotent the same way confirmStoreOrderPayment
 * is: a repeated callback for the same checkoutRequestId is a no-op
 * because the JournalEntry's idempotencyKey already exists.
 *
 * Posts the campaign's own dedicated Account +amountKes (its running
 * "raised" total, read back by getCampaignStats) against the platform
 * SETTLEMENT account -amountKes — a plain two-line balanced entry, no
 * fee split, matching the prototype's "100% goes to the group, minus
 * standard M-Pesa fees" promise.
 */
export interface DonationNotifyInfo {
  donorName: string;
  anonymous: boolean;
  donorMsisdn: string;
  amountKes: number;
  campaignTitle: string;
  orgName: string;
  receiptCode: string;
  /** Numbers to alert — the page's own ADMIN team members' phones,
   *  falling back to the page's public contact number if no admin has
   *  one on file. Never empty and never undefined-y — a caller can
   *  just iterate it. */
  adminMsisdns: string[];
}

export interface ConfirmDonationResult {
  donation: Awaited<ReturnType<typeof prisma.donation.update>>;
  /** False on an idempotent replay (a repeated Daraja callback for a
   *  checkoutRequestId already confirmed) — callers use this to avoid
   *  sending the thank-you/admin-alert SMS twice for the same gift. */
  justConfirmed: boolean;
  /** Only populated when justConfirmed — no reason to pull page/team
   *  data on the no-op replay path. */
  notify?: DonationNotifyInfo;
}

export async function confirmDonationPayment(checkoutRequestId: string, mpesaReceiptCode: string): Promise<ConfirmDonationResult> {
  const donation = await prisma.donation.findUnique({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: {
      campaign: {
        include: {
          page: {
            include: {
              organisation: { select: { officialName: true } },
              team: {
                where: { role: 'ADMIN', removedAt: null, person: { person: { msisdn: { not: null } } } },
                include: { person: { include: { person: { select: { msisdn: true } } } } },
              },
            },
          },
        },
      },
    },
  });
  if (!donation) throw new DonationError('No donation matches this payment', 'NOT_FOUND');
  if (donation.status !== 'PENDING') return { donation, justConfirmed: false };
  if (!donation.campaign.accountId) throw new Error('Campaign has no ledger account — this should never happen');

  const existingEntry = await prisma.journalEntry.findUnique({ where: { idempotencyKey: checkoutRequestId } });
  const code = receiptCode();

  const updated = await prisma.$transaction(async (tx) => {
    let entryId = existingEntry?.id;
    if (!existingEntry) {
      const settlement = await findOrCreateSettlementAccount(tx);
      const entry = await tx.journalEntry.create({
        data: {
          reference: `DONATION-${donation.id}`,
          description: `Donation to ${donation.campaign.title}`,
          idempotencyKey: checkoutRequestId,
          postings: {
            create: [
              { accountId: donation.campaign.accountId!, amount: Number(donation.amountKes) },
              { accountId: settlement.id, amount: -Number(donation.amountKes) },
            ],
          },
        },
      });
      entryId = entry.id;
    }

    return tx.donation.update({
      where: { id: donation.id },
      data: {
        status: 'CONFIRMED', confirmedAt: new Date(),
        mpesaReceiptCode, receiptCode: code, journalEntryId: entryId,
      },
    });
  });

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'donation.confirmed', targetType: 'donation', targetId: donation.id,
    payload: { mpesaReceiptCode, campaignId: donation.campaignId },
  });

  const adminMsisdns = donation.campaign.page.team
    .map((m) => m.person?.person?.msisdn)
    .filter((n): n is string => Boolean(n));
  if (adminMsisdns.length === 0 && donation.campaign.page.contactPhone) {
    adminMsisdns.push(donation.campaign.page.contactPhone);
  }

  return {
    donation: updated,
    justConfirmed: true,
    notify: {
      donorName: donation.donorName,
      anonymous: donation.anonymous,
      donorMsisdn: donation.donorMsisdn,
      amountKes: Number(donation.amountKes),
      campaignTitle: donation.campaign.title,
      orgName: donation.campaign.page.organisation.officialName,
      receiptCode: code,
      adminMsisdns,
    },
  };
}

/**
 * Called from the M-Pesa callback when Safaricom reports the STK push
 * did NOT succeed (cancelled by the donor, insufficient balance, a
 * timeout, …) — the counterpart to confirmDonationPayment's success
 * path. Idempotent the same way: a repeated callback for an already
 * terminal donation (FAILED or CONFIRMED) is a safe no-op.
 */
export async function failDonationPayment(checkoutRequestId: string, reason: string) {
  const donation = await prisma.donation.findUnique({ where: { mpesaCheckoutRequestId: checkoutRequestId } });
  if (!donation) throw new DonationError('No donation matches this payment', 'NOT_FOUND');
  if (donation.status !== 'PENDING') return donation;

  const updated = await prisma.donation.update({
    where: { id: donation.id },
    data: { status: 'FAILED', failureReason: reason },
  });

  await recordAudit(systemCtx('mpesa-callback'), {
    action: 'donation.failed', targetType: 'donation', targetId: donation.id,
    payload: { reason, campaignId: donation.campaignId },
  });

  return updated;
}

/** Donation-status lookup for the donor's own waiting/receipt screen. No capability — the donation id is the secret. */
export async function getDonation(donationId: string) {
  return prisma.donation.findUnique({ where: { id: donationId }, include: { campaign: true } });
}

export async function listDonationsForPage(pageId: string, take = 100) {
  return prisma.donation.findMany({
    where: { campaign: { pageId }, status: 'CONFIRMED' },
    include: { campaign: { select: { title: true } } },
    orderBy: { confirmedAt: 'desc' },
    take,
  });
}

/* ═══════════════════════════ staff / admin ═══════════════════════════ */

export interface ListDonationsForStaffFilter {
  status?: DonationStatus;
  search?: string;
  take?: number;
  skip?: number;
}

/** Every donation, platform-wide, any status — oversight for the admin
 *  app's Our Jamii > Donations screen. listDonationsForPage (above) is
 *  one page's confirmed donations only, for that page's own dashboard. */
export async function listDonationsForStaff(ctx: Ctx, f: ListDonationsForStaffFilter = {}) {
  requireCapability(ctx, 'jamii-donation.read');

  const where = {
    status: f.status,
    ...(f.search
      ? {
          OR: [
            { donorName: { contains: f.search, mode: 'insensitive' as const } },
            { donorMsisdn: { contains: f.search } },
            { campaign: { title: { contains: f.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.donation.findMany({
      where,
      include: {
        campaign: { select: { title: true, page: { include: { organisation: { select: { officialName: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    prisma.donation.count({ where }),
  ]);
  return { rows, total };
}

export async function getDonationTotalsForStaff(ctx: Ctx) {
  requireCapability(ctx, 'jamii-donation.read');
  const [confirmed, pending, failed, sum] = await Promise.all([
    prisma.donation.count({ where: { status: 'CONFIRMED' } }),
    prisma.donation.count({ where: { status: 'PENDING' } }),
    prisma.donation.count({ where: { status: 'FAILED' } }),
    prisma.donation.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amountKes: true } }),
  ]);
  return { confirmed, pending, failed, raisedKes: Number(sum._sum.amountKes ?? 0) };
}
