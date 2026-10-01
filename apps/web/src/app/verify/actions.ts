'use server';
import { anonCtx, verifyCertificate, verifyReceipt, type VerifyResult, type VerifyReceiptResult } from '@esoqo/db';
import {
  transactionCodeKind, TRANSACTION_CODE_KINDS, TRANSACTION_CODE_KIND_LABELS,
} from '@esoqo/domain';

export type { VerifyResult, VerifyReceiptResult };

/**
 * Public certificate check. No account, no session — deliberately.
 * This is the page an institution uses before it becomes a customer.
 */
export async function lookupCertificate(code: string): Promise<VerifyResult> {
  return verifyCertificate(anonCtx(), code);
}

export type LookupCodeResult =
  | { kind: 'receipt'; result: VerifyReceiptResult }
  | { kind: 'certificate'; result: VerifyResult }
  /** A code that IS one of ours, but not a receipt — a donation, a
   *  business payment, a wallet top-up. Answered with what it actually
   *  is rather than being fed to a lookup that can only say "no". */
  | { kind: 'other-reference'; referenceLabel: string };

/**
 * The one entry point both the manual /verify form and the /verify/[code]
 * SMS-link page call.
 *
 * Routing is on the two-character KIND prefix (transactionCodeKind), not
 * on isTransactionCodeValid. The checksum exists to catch a mistyped
 * character, and it is good at that — but it is the wrong instrument for
 * choosing a table, for two reasons. A code this page cannot resolve is
 * almost always mistyped rather than belonging to another product line,
 * and a checksum is the thing that goes wrong exactly when the code IS
 * mistyped: route on it and a shopper who fat-fingers one character of
 * their RC… code is told they have a bad *certificate*, which is both
 * wrong and unactionable. The prefix is the first thing a person copies
 * correctly and the last thing they get wrong, so it is what to trust
 * for "what should I search".
 *
 * The third arm exists because the other six kinds are codes this
 * platform mints and hands to customers by SMS. Someone reading one off
 * their phone deserves to be told what it is, not "no certificate with
 * that code".
 */
export async function lookupCode(code: string): Promise<LookupCodeResult> {
  const kind = transactionCodeKind(code);
  if (kind === TRANSACTION_CODE_KINDS.RECEIPT) {
    return { kind: 'receipt', result: await verifyReceipt(anonCtx(), code) };
  }
  if (kind) return { kind: 'other-reference', referenceLabel: TRANSACTION_CODE_KIND_LABELS[kind] };
  return { kind: 'certificate', result: await verifyCertificate(anonCtx(), code) };
}
