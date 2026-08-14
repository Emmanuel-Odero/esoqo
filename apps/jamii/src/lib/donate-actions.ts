'use server';

import {
  createDonation, attachDonationCheckoutRequestId, confirmDonationPayment, getDonation,
} from '@esoko/db';
import { donateSchema } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A PUBLIC HTTP ENDPOINT wearing a function signature — a donor need
 * not be signed in. Direct copy of apps/store's checkout() in
 * src/app/s/[slug]/actions.ts: place the donation, push STK, and in
 * console mode it auto-confirms so the receipt screen is honestly
 * testable without live Daraja credentials.
 */
export async function donate(raw: unknown): Promise<ActionResult<{ donationId: string; status: string }>> {
  const parsed = donateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const ctx = await getCtx();

  let donation;
  try {
    donation = await createDonation(ctx, {
      campaignId: parsed.data.campaignId,
      donorName: parsed.data.donorName ?? '',
      donorMsisdn: parsed.data.donorMsisdn,
      amountKes: parsed.data.amountKes,
      anonymous: parsed.data.anonymous,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not record your gift' };
  }

  try {
    const push = await initiateStkPush({
      msisdn: parsed.data.donorMsisdn,
      amountKes: parsed.data.amountKes,
      accountReference: `JAMII${donation.id.slice(0, 8)}`,
      description: 'Our Jamii donation',
    });
    await attachDonationCheckoutRequestId(donation.id, push.checkoutRequestId);
    if (push.autoConfirmed) {
      await confirmDonationPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    }
  } catch (e) {
    return { ok: false, error: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment' };
  }

  const updated = await getDonation(donation.id);
  return { ok: true, data: { donationId: donation.id, status: updated?.status ?? 'PENDING' } };
}

/** Polled by the waiting screen while a real Daraja callback is in flight. */
export async function checkDonationStatus(donationId: string): Promise<{ status: string; receiptCode: string | null; mpesaReceiptCode: string | null }> {
  const donation = await getDonation(donationId);
  return {
    status: donation?.status ?? 'PENDING',
    receiptCode: donation?.receiptCode ?? null,
    mpesaReceiptCode: donation?.mpesaReceiptCode ?? null,
  };
}
