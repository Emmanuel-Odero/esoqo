'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@esoqo/auth';
import { createVoucherSchema, loadVoucherSchema } from '@esoqo/domain';
import { goFetch } from '@/lib/ticketing';

async function token() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? '';
}

export async function actionCreateVoucher(raw: unknown) {
  const parsed = createVoucherSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  try {
    const t = await token();
    const res = await goFetch('/v1/vouchers', t, { method: 'POST', body: JSON.stringify(parsed.data) });
    revalidatePath('/me/vouchers');
    return { ok: true as const, data: (res as { voucher: unknown }).voucher };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not create voucher.' };
  }
}

export async function actionLoadVoucher(id: string, raw: unknown) {
  // Typed as unknown, not {amountKes:number}: the TypeScript annotation
  // is erased at runtime and this entry point is reachable by anyone.
  const parsed = loadVoucherSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  try {
    const t = await token();
    await goFetch(`/v1/vouchers/${id}/load`, t, { method: 'POST', body: JSON.stringify(parsed.data) });
    revalidatePath('/me/vouchers');
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Could not top up.' };
  }
}
