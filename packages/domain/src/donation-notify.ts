/**
 * SMS copy for a confirmed Our Jamii donation — pure text composition,
 * no I/O. Lives here (not in @esoqo/db, which can't depend on
 * @esoqo/auth's sendSms — see dal/groups.ts's InviteMemberResult
 * comment for that direction) so both callers that actually send the
 * SMS — apps/jamii's donate() (console-mode auto-confirm) and
 * services/core's Daraja webhook handler (the real confirmation path)
 * — compose the exact same wording instead of drifting apart.
 *
 * ## The shape of this copy
 *
 * Both messages lead with **who is speaking**, the way a bank or M-Pesa
 * SMS does ("KCB: ...", "Confirmed."). The recipient sees the sender ID
 * (ESOQO) and then the first three or four words, and that has to be
 * enough to know what this is. A thank-you that opens with the donor's
 * own name and closes with a signature spends its most-read characters
 * on the least useful information.
 *
 * Every variable field is clamped with `fit` — a campaign title and an
 * org name are each validated at 160 characters (jamii.ts), so either
 * one alone can overrun the whole message. The budgets below are chosen
 * so the *worst case* still lands in one GSM-7 segment; sms.test.ts
 * holds that line.
 */
import { sms, fit, firstName, smsKes } from './sms';

export interface DonationNotifyContext {
  donorName: string;
  anonymous: boolean;
  amountKes: number;
  campaignTitle: string;
  orgName: string;
  receiptCode: string;
}

/**
 * Sent to the donor's own phone once their gift is confirmed.
 *
 * The organisation is the voice, not a trailing credit: "Tumaini Trust:
 * asante Jane!" is a thank-you from the people the donor chose to help,
 * which is what makes someone give a second time. "Our Jamii" is the
 * rails, and rails do not need thanking.
 *
 * The first name only — "Asante Jane!" is warmer than "Asante Jane
 * Wanjiku Kamau!" and buys back 13 characters for the campaign title.
 */
export function donorThankYouSms(ctx: DonationNotifyContext): string {
  const greeting = ctx.anonymous ? 'asante!' : `asante ${firstName(ctx.donorName)}!`;
  return sms`${fit(ctx.orgName, 30)}: ${greeting} Your ${smsKes(ctx.amountKes)} gift to ${fit(ctx.campaignTitle, 42)} is confirmed. Receipt ${ctx.receiptCode}.`;
}

/**
 * Sent to the org's page admin(s) so they know a gift landed without
 * having to check the dashboard.
 *
 * Money first: for an admin the amount *is* the news, and it is what
 * they need to read off a locked screen without opening anything.
 */
export function adminDonationAlertSms(ctx: DonationNotifyContext): string {
  const who = ctx.anonymous ? 'an anonymous supporter' : fit(ctx.donorName, 24);
  return sms`Our Jamii: ${smsKes(ctx.amountKes)} from ${who} for ${fit(ctx.campaignTitle, 50)}. Receipt ${ctx.receiptCode}.`;
}
