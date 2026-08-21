'use server';

import {
  createDonation, attachDonationCheckoutRequestId, confirmDonationPayment, getDonation,
  type ConfirmDonationResult,
} from '@esoko/db';
import { donateSchema, donorThankYouSms, adminDonationAlertSms } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { sendSms } from '@esoko/auth/sms';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Thank the donor and alert the page's admins once a gift is actually
 * confirmed — best-effort: an SMS provider hiccup must never fail the
 * donation flow itself, matching apps/app/me/group/actions.ts's
 * inviteMember precedent.
 */
async function notifyDonationConfirmed(result: ConfirmDonationResult): Promise<void> {
  if (!result.justConfirmed || !result.notify) return;
  const n = result.notify;
  try {
    await sendSms(n.donorMsisdn, donorThankYouSms(n), 'donation-thank-you');
    await Promise.all(n.adminMsisdns.map((to) => sendSms(to, adminDonationAlertSms(n), 'donation-admin-alert')));
  } catch {
    // best-effort — the donation itself already succeeded.
  }
}

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
      const result = await confirmDonationPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
      await notifyDonationConfirmed(result);
    }
  } catch (e) {
    return { ok: false, error: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment' };
  }

  const updated = await getDonation(donation.id);
  return { ok: true, data: { donationId: donation.id, status: updated?.status ?? 'PENDING' } };
}

/** Polled by the waiting screen while a real Daraja callback is in flight. */
export async function checkDonationStatus(donationId: string): Promise<{
  status: string; receiptCode: string | null; mpesaReceiptCode: string | null; failureReason: string | null;
}> {
  const donation = await getDonation(donationId);
  return {
    status: donation?.status ?? 'PENDING',
    receiptCode: donation?.receiptCode ?? null,
    mpesaReceiptCode: donation?.mpesaReceiptCode ?? null,
    failureReason: donation?.failureReason ?? null,
  };
}
