'use server';
import { anonCtx, verifyCertificate, type VerifyResult } from '@esoko/db';

export type { VerifyResult };

/**
 * Public certificate check. No account, no session — deliberately.
 * This is the page an institution uses before it becomes a customer.
 */
export async function lookupCertificate(code: string): Promise<VerifyResult> {
  return verifyCertificate(anonCtx(), code);
}
