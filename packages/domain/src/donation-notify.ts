/**
 * SMS copy for a confirmed Our Jamii donation — pure text composition,
 * no I/O. Lives here (not in @esoko/db, which can't depend on
 * @esoko/auth's sendSms — see dal/groups.ts's InviteMemberResult
 * comment for that direction) so both callers that actually send the
 * SMS — apps/jamii's donate() (console-mode auto-confirm) and
 * services/core's Daraja webhook handler (the real confirmation path)
 * — compose the exact same wording instead of drifting apart.
 */
export interface DonationNotifyContext {
  donorName: string;
  anonymous: boolean;
  amountKes: number;
  campaignTitle: string;
  orgName: string;
  receiptCode: string;
}

function kes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-KE')}`;
}

/** Sent to the donor's own phone once their gift is confirmed. */
export function donorThankYouSms(ctx: DonationNotifyContext): string {
  const who = ctx.anonymous ? '' : `${ctx.donorName.trim()}, `;
  return `${who}asante sana! Your ${kes(ctx.amountKes)} gift to ${ctx.campaignTitle} (${ctx.orgName}) was received. Receipt: ${ctx.receiptCode}. — Our Jamii`;
}

/** Sent to the org's page admin(s) so they know a gift landed without
 *  having to check the dashboard. */
export function adminDonationAlertSms(ctx: DonationNotifyContext): string {
  const who = ctx.anonymous ? 'An anonymous supporter' : ctx.donorName.trim();
  return `${who} just gave ${kes(ctx.amountKes)} to ${ctx.campaignTitle}. — Our Jamii`;
}
