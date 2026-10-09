'use server';

import { createJamiiPage } from '@esoqo/db';
import { startJamiiPageSchema } from '@esoqo/domain/jamii';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function actionStartJamiiPage(raw: unknown): Promise<ActionResult<{ slug: string }>> {
  const parsed = startJamiiPageSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const ctx = await getCtx();
  if (ctx.actorType !== 'SUBJECT' || !ctx.partyId) {
    return { ok: false, error: 'Sign in first, then start your page' };
  }

  try {
    const { slug } = await createJamiiPage(ctx, {
      orgKind: parsed.data.orgKind as never,
      orgKindOther: parsed.data.orgKindOther || undefined,
      officialName: parsed.data.officialName,
      county: parsed.data.county,
      ward: parsed.data.ward || undefined,
      registrationNo: parsed.data.registrationNo || undefined,
      memberCount: parsed.data.memberCount,
      tagline: parsed.data.tagline || undefined,
    });
    return { ok: true, data: { slug } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start your page' };
  }
}
