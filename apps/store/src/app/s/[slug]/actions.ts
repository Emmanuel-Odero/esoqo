'use server';

import {
  createStoreOrder, attachCheckoutRequestId, confirmStoreOrderPayment, getOrder, getMyRecord,
} from '@esoko/db';
import { checkoutSchema } from '@esoko/domain';
import { initiateStkPush, MpesaError } from '@esoko/payments';
import { getCtx } from '@/lib/session';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A PUBLIC HTTP ENDPOINT wearing a function signature — the buyer need
 * not be signed in. Validates at the boundary with the schema the
 * client form also uses, then places the order.
 *
 * Payment branches on checkoutSchema.paymentMethod:
 *  - MPESA_STK: place the order, trigger the STK push. In console mode
 *    the push auto-confirms, so the order is already PAID on return.
 *  - CASH_ON_DELIVERY: no push — the order waits at PENDING_PAYMENT and
 *    the merchant confirms payment when the cash is collected.
 */
export async function checkout(raw: unknown): Promise<ActionResult<{ orderId: string; status: string; dispatchFrom: string | null }>> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const ctx = await getCtx();

  let order;
  try {
    order = await createStoreOrder(ctx, {
      storeSlug: parsed.data.storeSlug,
      buyerName: parsed.data.buyerName,
      buyerMsisdn: parsed.data.buyerMsisdn,
      paymentMethod: parsed.data.paymentMethod,
      items: parsed.data.items,
      deliveryOptionId: parsed.data.deliveryOptionId,
      collectionNotes: parsed.data.collectionNotes,
      deliveryAddress: parsed.data.deliveryAddress,
      buyingOrgId: parsed.data.buyingOrgId,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not place your order' };
  }

  const dispatchFrom = (o: typeof order & { store?: { dispatchWarehouseOrg?: { officialName: string; knownAs: string | null } | null } } | null) => {
    const org = o?.store?.dispatchWarehouseOrg;
    return org ? (org.knownAs || org.officialName) : null;
  };

  // Cash on delivery stops here — the buyer owes at the door.
  if (parsed.data.paymentMethod === 'CASH_ON_DELIVERY') {
    const withStore = await getOrder(ctx, order.id);
    return { ok: true, data: { orderId: order.id, status: 'PENDING_PAYMENT', dispatchFrom: dispatchFrom(withStore) } };
  }

  try {
    const push = await initiateStkPush({
      msisdn: parsed.data.buyerMsisdn,
      amountKes: Number(order.totalKes),
      accountReference: `EK${order.id.slice(0, 8)}`,
      description: `Order at ${parsed.data.storeSlug}`,
    });
    await attachCheckoutRequestId(order.id, push.checkoutRequestId);
    if (push.autoConfirmed) {
      await confirmStoreOrderPayment(push.checkoutRequestId, push.mpesaReceiptCode ?? '');
    }
  } catch (e) {
    return { ok: false, error: e instanceof MpesaError ? e.message : 'Could not start the M-Pesa payment' };
  }

  const updated = await getOrder(ctx, order.id);
  return {
    ok: true,
    data: { orderId: order.id, status: updated?.status ?? 'PENDING_PAYMENT', dispatchFrom: dispatchFrom(updated) },
  };
}

/** Orgs the visitor can check out on behalf of — empty for an anonymous
 *  buyer or one with no memberships, which is the common case and keeps
 *  the storefront's default "buying for myself" checkout unchanged. */
export async function myOrgMemberships(): Promise<{ id: string; name: string }[]> {
  const ctx = await getCtx();
  if (!ctx.partyId) return [];
  const me = await getMyRecord(ctx);
  return (me?.memberships ?? []).map((m) => ({
    id: m.org.partyId,
    name: m.org.knownAs || m.org.officialName || 'Unnamed organisation',
  }));
}

/** Polled by the waiting screen while a real Daraja callback is in flight.
 *  dispatchFrom is set only when the store has a formal warehouse
 *  relationship (Store.dispatchWarehouseOrgId) — display-only, no
 *  fulfilment logic depends on it. */
export async function checkOrderStatus(orderId: string): Promise<{ status: string; dispatchFrom: string | null }> {
  const ctx = await getCtx();
  const order = await getOrder(ctx, orderId);
  const org = order?.store.dispatchWarehouseOrg;
  return {
    status: order?.status ?? 'PENDING_PAYMENT',
    dispatchFrom: org ? (org.knownAs || org.officialName) : null,
  };
}
