import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getReceipt, listStoreProducts } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { ItemizeClient } from './ItemizeClient';

export const metadata: Metadata = { title: 'Add items to a receipt' };
export const dynamic = 'force-dynamic';

export default async function ItemizeReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSubject();

  let receipt;
  try {
    receipt = await getReceipt(ctx, id);
  } catch {
    notFound();
  }

  // Already itemized, or not the kind of receipt this screen is for
  // (a PosSale/StoreOrder receipt already has its items) — nothing to
  // do here.
  if (!receipt.businessPaymentId || receipt.items.length > 0) {
    redirect('/dashboard/receipts');
  }

  const products = await listStoreProducts(ctx, receipt.storeId);

  return (
    <ItemizeClient
      receiptId={receipt.id}
      receiptCode={receipt.receiptCode ?? receipt.receiptNo}
      totalKes={Number(receipt.totalKes)}
      buyerName={receipt.businessPayment?.payerName ?? null}
      buyerMsisdn={receipt.businessPayment?.payerMsisdn ?? null}
      products={products.map((p) => ({ id: p.id, name: p.name, priceKes: Number(p.priceKes), stockQty: p.stockQty }))}
    />
  );
}
