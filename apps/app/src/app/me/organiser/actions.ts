'use server';
import { revalidatePath } from 'next/cache';
import { createTicketOrg } from '@esoko/db';
import { createTicketOrgSchema, toSafeErrorMessage } from '@esoko/domain';
import { requireSubject } from '@/lib/session';

const FALLBACK = "That didn't go through. Please try again.";

export async function actionCreateTicketOrg(raw: unknown) {
  const parsed = createTicketOrgSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check what you entered' };
  try {
    const ctx = await requireSubject();
    const org = await createTicketOrg(ctx, parsed.data);
    revalidatePath('/me/organiser');
    return { ok: true as const, data: { orgId: org.id } };
  } catch (e) {
    console.error(e);
    return { ok: false as const, error: toSafeErrorMessage(e, FALLBACK) };
  }
}
