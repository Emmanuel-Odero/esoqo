'use server';

import { headers } from 'next/headers';
import {
  findJamiiApplicant, getApplicantContactDetails, createJamiiInterest, JAMII_INTEREST_CREATE, type Ctx,
} from '@esoko/db';
import { jamiiApplicantCheckSchema, jamiiInterestSchema } from '@esoko/domain';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Anonymous by design, same shape as apps/app/src/app/join/actions.ts's
 *  requestCtx: a narrowly-scoped SYSTEM Ctx that can do exactly this
 *  one write. No staff role should ever hold JAMII_INTEREST_CREATE. */
async function anonApplyCtx(): Promise<Ctx> {
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: [JAMII_INTEREST_CREATE],
    ip: await clientIp(),
    __verified: true,
  };
}

/** Step 1 — do we already have this person's details? Deliberately
 *  returns only a display name, never the phone/email/county actually
 *  on file, so this can't be used to enumerate or confirm someone
 *  else's account details. */
export async function actionCheckApplicant(
  raw: unknown,
): Promise<ActionResult<{ matched: boolean; displayName?: string }>> {
  const parsed = jamiiApplicantCheckSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a phone number or email' };

  const found = await findJamiiApplicant(parsed.data.identifier);
  return { ok: true, data: found ? { matched: true, displayName: found.displayName } : { matched: false } };
}

/**
 * Step 2 — submits the application. Re-resolves the match server-side
 * rather than trusting a `matched` flag from the client: the browser
 * could otherwise claim a match and have this linked to an arbitrary
 * account. When matched, the applicant's own fullName/msisdn/email are
 * pulled from their existing Person record — not from the form, which
 * for that path asks for nothing but the identifier and an optional
 * note — so "we already have your details" is actually true, not just
 * a UI promise.
 */
export async function actionSubmitApplication(raw: unknown): Promise<ActionResult> {
  const parsed = jamiiInterestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Check your details', field: issue?.path[0] as string | undefined };
  }
  const input = parsed.data;

  try {
    const matched = await findJamiiApplicant(input.identifier);

    if (matched) {
      const person = await getApplicantContactDetails(matched.partyId);
      if (!person) return { ok: false, error: 'Something went wrong finding your details. Please try again.' };

      await createJamiiInterest(await anonApplyCtx(), {
        fullName: person.officialName,
        msisdn: person.msisdn ?? '',
        email: person.email ?? undefined,
        message: input.message,
        personId: matched.partyId,
      });
      return { ok: true, data: undefined };
    }

    if (!input.fullName?.trim()) return { ok: false, error: 'Enter your name', field: 'fullName' };
    if (!input.msisdn?.trim()) return { ok: false, error: 'Enter your phone number', field: 'msisdn' };
    if (!input.county?.trim()) return { ok: false, error: 'Choose your county', field: 'county' };

    await createJamiiInterest(await anonApplyCtx(), {
      fullName: input.fullName,
      msisdn: input.msisdn,
      email: input.email,
      county: input.county,
      organisationName: input.organisationName,
      message: input.message,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "That didn't go through — please try again." };
  }
}
