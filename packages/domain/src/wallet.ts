/**
 * Schemas and constants for the wallet money-movement features — withdrawal
 * to M-Pesa and Esoqo-to-Esoqo transfer by handle. See
 * packages/db/src/dal/wallet-withdrawal.ts and dal/esoqo-transfer.ts.
 */
import { z } from 'zod';

const kesSchema = z.coerce.number().positive('Enter an amount above zero').max(10_000_000);

/** Safaricom's own B2C floor — a payout request below this is refused by
 *  Daraja itself, so refusing it here is a better message than letting the
 *  push fail after a row is already written. */
export const MIN_WITHDRAWAL_KES = 10;

export const withdrawWalletSchema = z.object({
  amountKes: kesSchema.min(MIN_WITHDRAWAL_KES, `Enter at least KES ${MIN_WITHDRAWAL_KES}`),
});
export type WithdrawWalletInput = z.infer<typeof withdrawWalletSchema>;

/** How much of a note a transfer's receipt/SMS carries — same bound
 *  BusinessPayment's NOTE_MAX already uses. */
const NOTE_MAX = 140;

export const transferSchema = z.object({
  /** An Esoqo handle, a phone number, or an email — resolved the same way
   *  findPayableBusinesses already resolves a business identifier. */
  toIdentifier: z.string().trim().min(1, 'Enter who you want to pay'),
  amountKes: kesSchema,
  note: z.string().trim().max(NOTE_MAX).optional(),
});
export type TransferInput = z.infer<typeof transferSchema>;
