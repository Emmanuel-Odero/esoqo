/**
 * SMS copy for store (POS / online order) notifications — same pure
 * composition pattern as donation-notify.ts, so apps/store's Server
 * Action doesn't own the wording.
 */
import { sms, fit, smsKes } from './sms';

export interface SaleReceiptContext {
  storeName: string;
  receiptNo: string;
  totalKes: number;
  /** Only ever present when a real KRA eTIMS integration supplied it. */
  etimsSerial?: string | null;
}

/**
 * The SMS copy of a receipt.
 *
 * Leads with the shop's name, which the old copy left out entirely.
 * That was the real defect: the message arrived from sender ID ESOQO
 * and opened "Receipt MAMA-NJERI-000147", leaving the customer to
 * reverse-engineer which of the day's several shops had texted them.
 * The receipt number carries a slug prefix, but a slug is not a name.
 *
 * The eTIMS serial is included only when there is one — see
 * dal/receipt.ts on why it is never invented. A missing serial costs us
 * nothing here; an invented one would be a compliance claim we cannot
 * back.
 */
export function saleReceiptSms(ctx: SaleReceiptContext): string {
  const etims = ctx.etimsSerial ? ` eTIMS ${fit(ctx.etimsSerial, 24)}.` : '';
  return sms`${fit(ctx.storeName, 28)}: receipt ${fit(ctx.receiptNo, 20)} for ${smsKes(ctx.totalKes)}.${etims} Asante for shopping with us.`;
}
