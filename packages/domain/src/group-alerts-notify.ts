/**
 * SMS copy for the contribution-gap digest — same reasoning as
 * donation-notify.ts: pure text composition, no I/O, so the one caller
 * that actually sends it (services/core's scheduled digest job) doesn't
 * have to own the wording.
 */
export interface StalledGroupContext {
  officialName: string;
  daysSinceLastContribution: number;
}

export function contributionGapSms(ctx: StalledGroupContext): string {
  return `${ctx.officialName}: no contribution recorded in ${ctx.daysSinceLastContribution} days. `
    + 'A quick nudge to members this week keeps the group on track. — Esoko';
}
