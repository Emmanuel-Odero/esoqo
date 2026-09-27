import type { Metadata } from 'next';
import { PayClient } from '../PayClient';
import { actionLookupBusiness, type BusinessLookup } from '../actions';

/**
 * /pay/business — the pay screen itself, on its own permanent address.
 *
 * The identical component backs the ?to= link on the hub, so a printed QR
 * and a menu choice land on exactly the same code path. This route
 * exists so "pay a business" is a link somebody can be sent, bookmarked
 * and put in a help article, rather than a page that only exists as a
 * query string.
 *
 * The lookup still resolves on the server, for the same reason it does
 * on the hub: a camera-opened link must not flash a form past before the
 * business appears.
 */

export const metadata: Metadata = {
  title: 'Pay a business — Esoqo',
  description: 'Scan a business stand or enter an Esoqo ID, choose an amount, and pay by M-Pesa.',
  robots: { index: true, follow: true },
};

export default async function PayBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string | string[]; amount?: string | string[] }>;
}) {
  const params = await searchParams;
  const to = first(params.to);
  const amount = first(params.amount);

  let initialLookup: BusinessLookup | null = null;
  if (to && to.trim()) {
    try {
      initialLookup = await actionLookupBusiness(to);
    } catch {
      initialLookup = { status: 'NOT_FOUND' };
    }
  }

  return (
    <PayClient
      initialLookup={initialLookup}
      prefillAmount={amount && /^\d+(\.\d{1,2})?$/.test(amount) ? amount : null}
    />
  );
}

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
