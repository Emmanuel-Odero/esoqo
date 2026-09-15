'use server';
import { verifyFareSchema } from '@esoqo/domain';
import { requireOrgAccess } from '@/lib/session';
import { orgGo } from '@/lib/ticketing';

export async function actionVerifyFare(orgId: string, raw: unknown) {
  const parsed = verifyFareSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the code.' };
  try {
    await requireOrgAccess(orgId);
    const res = await orgGo<unknown>(orgId, '/v1/fares/verify', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    return { ok: true as const, data: res };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't verify." };
  }
}
