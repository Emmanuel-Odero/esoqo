'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import {
  attachRegistrationCheckoutRequestId, confirmRegistrationPaymentByCheckoutId,
  getRegistration, getRegistrationDetail, type Ctx,
} from '@esoko/db';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { msisdnSchema, toSafeErrorMessage } from '@esoko/domain';
import { ownsRegistration } from './ownership';

/**
 * The "pay now" option on the registration fee step — a real M-Pesa STK
 * push, alongside the existing "group already paid" and manual
 * transaction-ID declaration paths (upload.ts). Modeled directly on
 * apps/store's checkout()/checkOrderStatus(): initiate the push, record
 * Daraja's CheckoutRequestID against the payment, and let the joiner's
 * browser poll while the real confirmation arrives asynchronously (or,
 * in MPESA_PROVIDER=console, has already arrived by the time this
 * returns).
 */

async function joinCtx(): Promise<Ctx> {
  const h = await headers();
  return {
    actorType: 'SYSTEM',
    actorId: null,
    capabilities: ['registration.write', 'registration.read'],
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    __verified: true,
  };
}

const stkSchema = z.object({
  registrationId: z.string().uuid(),
  msisdn: msisdnSchema,
  amountKes: z.coerce.number().int().min(1, 'Enter an amount').max(1_000_000),
});

export type StkResult =
  | { ok: true; status: 'CONFIRMED' | 'DECLARED' }
  | { ok: false; error: string };

export async function actionInitiateStkPush(raw: unknown): Promise<StkResult> {
  try {
    const v = stkSchema.parse(raw);
    if (!(await ownsRegistration(v.registrationId))) return { ok: false, error: 'Registration not found' };

    const ctx = await joinCtx();
    const reg = await getRegistration(ctx, v.registrationId);
    if (!reg) return { ok: false, error: 'Registration not found' };

    const push = await initiateStkPush({
      msisdn: v.msisdn,
      amountKes: v.amountKes,
      accountReference: `EK${v.registrationId.slice(0, 8)}`,
      description: 'Esoko registration fee',
    });

    await attachRegistrationCheckoutRequestId(ctx, v.registrationId, push.checkoutRequestId, v.amountKes, v.msisdn);

    if (push.autoConfirmed) {
      await confirmRegistrationPaymentByCheckoutId(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
      return { ok: true, status: 'CONFIRMED' };
    }
    return { ok: true, status: 'DECLARED' };
  } catch (e) {
    console.error(e);
    if (e instanceof MpesaError) return { ok: false, error: e.message };
    return { ok: false, error: toSafeErrorMessage(e, "We couldn't start that M-Pesa payment. Try again in a moment.") };
  }
}

/** Polled by the waiting screen while a real Daraja callback is in flight
 *  (console/sandbox mode resolves this on the first call, since
 *  initiateStkPush already auto-confirmed by the time actionInitiateStkPush
 *  returned — this just lets the UI confirm the same thing). */
export async function actionCheckPaymentStatus(registrationId: string): Promise<{ status: string }> {
  if (!(await ownsRegistration(registrationId))) return { status: 'NOT_DECLARED' };
  const ctx = await joinCtx();
  const detail = await getRegistrationDetail(ctx, registrationId);
  return { status: detail?.payment?.status ?? 'NOT_DECLARED' };
}
