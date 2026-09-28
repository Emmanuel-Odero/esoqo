/**
 * SMS copy for group (chama / SACCO / self-help group) notifications —
 * same reasoning as donation-notify.ts: pure text composition, no I/O,
 * so the callers that actually send these (services/core's scheduled
 * digest job, apps/app's invite Server Action) don't own the wording.
 *
 * Group names are validated at 160 characters (treasury.ts), so the
 * name is clamped with `fit` and the budgets are set so the worst case
 * still lands in one GSM-7 segment. See sms.ts for why that matters.
 */
import { sms, fit, firstName, smsKes } from './sms';

export interface StalledGroupContext {
  officialName: string;
  daysSinceLastContribution: number;
}

/**
 * The quiet-group nudge.
 *
 * Deliberately not a reprimand. The old wording ("no contribution
 * recorded in 14 days. A quick nudge to members this week keeps the
 * group on track") read like an audit finding, and the people receiving
 * it are volunteer treasurers who are already doing unpaid work. It
 * states the fact, then hands them one small thing to do — which is
 * also the only thing that actually moves the number.
 */
export function contributionGapSms(ctx: StalledGroupContext): string {
  return sms`${fit(ctx.officialName, 60)}: no contribution recorded in ${ctx.daysSinceLastContribution} days. A word to members this week keeps the group moving.`;
}

/**
 * Sent to someone an officer has just added to a group.
 *
 * This is a cold message — the recipient did not ask for it and may not
 * know Esoqo at all. So: greet, name the person who actually added them
 * (a chairperson or treasurer is someone you trust; "Esoqo" alone is a
 * stranger's app), say plainly that this is a savings group, and give
 * exactly one action with a reason to take it. The old copy named
 * neither the inviter nor what a chama membership even is — a stranger
 * reading it had no way to tell this apart from spam.
 *
 * `inviterName` is optional: inviteMember's existing-vs-new-person
 * branch can invite someone who signs in before the inviter's own name
 * has been confirmed on their record, so this degrades to the old
 * "you have been added" phrasing rather than printing "undefined".
 */
export function groupInviteSms(
  orgName: string,
  opts: { joinFeeKes?: number; inviterName?: string } = {},
): string {
  const by = opts.inviterName ? firstName(opts.inviterName) : null;
  const added = by ? sms`${by} added you to` : sms`You have been added to`;
  // A group that charges a join fee leaves the membership PENDING (see
  // resolveJoinStatus in packages/db/src/dal/groups.ts), so the plain
  // "sign in and see balances" promise above would be a lie: they'd sign
  // in, see nothing, and have no idea why. Name the fee and the one
  // action that clears it instead.
  if (opts.joinFeeKes && opts.joinFeeKes > 0) {
    return sms`Karibu! ${added} ${fit(orgName, 30)} on Esoqo. Sign in on this number and pay the ${smsKes(opts.joinFeeKes)} join fee to take your place.`;
  }
  return sms`Karibu! ${added} ${fit(orgName, 45)}, a savings group on Esoqo. Sign in with this number to see contributions and balances.`;
}

/* ── contributions ────────────────────────────────────────────────
 *
 * The web (apps/app, apps/admin) and the mobile app reach the same
 * group treasury through two different services, so the same two events
 * are composed twice: here for the Next.js Server Actions that call the
 * Prisma DAL directly, and in services/core-go/internal/notify for the
 * Go API the mobile app uses. The wording is deliberately identical —
 * a member must not be able to tell which surface their treasurer
 * happened to use from the text they receive.
 */

export interface ContributionDeclaredContext {
  amountKes: number;
  /** How they say they paid — "cash", "mpesa". Lowercased into the copy. */
  method: string;
  /** Short handle the officer and the member can match on. */
  reference: string;
}

/**
 * The contributor's own immediate receipt for a declaration that is not
 * yet confirmed. Without it, someone who hands over cash hears nothing
 * at all until an officer gets round to confirming — which may be days,
 * and is exactly the silence that makes people ask whether the money
 * arrived.
 */
export function contributionDeclaredSms(ctx: ContributionDeclaredContext): string {
  return sms`Esoqo: your ${smsKes(ctx.amountKes)} contribution (${fit(ctx.method.toLowerCase(), 12)}) was recorded - ref ${ctx.reference}. You'll get a text once it's confirmed.`;
}

export interface ContributionConfirmedContext {
  amountKes: number;
  contributorName: string;
  orgName: string;
  newBalanceKes: number;
  reference: string;
}

/**
 * Sent to every active member once money is actually credited — not
 * just to whoever paid. That fan-out is the point: the balance stops
 * being something only the treasurer can see, which is the cheapest
 * trust the product can buy a chama.
 */
export function contributionConfirmedSms(ctx: ContributionConfirmedContext): string {
  return sms`${smsKes(ctx.amountKes)} from ${fit(ctx.contributorName, 20)} credited to ${fit(ctx.orgName, 28)}, new balance ${smsKes(ctx.newBalanceKes)} - ref ${ctx.reference}`;
}

/* ── withdrawals ──────────────────────────────────────────────────
 *
 * Every contribution event above has had an SMS since the templates
 * existed; withdrawal — money actually leaving a group's account —
 * had none until now. Scoped to signers only, not every member: they
 * are the ones with something to do, and SMS is billed per recipient
 * to a group that may have 20+ people. Everyone else finds out via the
 * free in-app activity feed (see GroupActivityEvent).
 */

export interface WithdrawalRequestedContext {
  orgName: string;
  amountKes: number;
  purpose: string;
  requesterName: string;
}

/** Sent to every effective signer the moment an officer proposes a
 *  withdrawal — they are the audience with a signature to give, and the
 *  standby window is already counting down whether or not they notice
 *  from inside the app. */
export function withdrawalRequestedSms(ctx: WithdrawalRequestedContext): string {
  return sms`${fit(ctx.requesterName, 16)} proposed a ${smsKes(ctx.amountKes)} withdrawal from ${fit(ctx.orgName, 24)} for ${fit(ctx.purpose, 40)}. Sign in to approve or reject.`;
}
