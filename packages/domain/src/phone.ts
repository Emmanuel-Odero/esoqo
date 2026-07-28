import { z } from 'zod';

/**
 * Kenyan MSISDN handling.
 *
 * Identity in Esoko is the phone number, so normalising it correctly is
 * a correctness requirement, not a convenience. Everything is stored in
 * E.164 (+2547XXXXXXXX). Accepts the four forms people actually type.
 */

const KE_MOBILE = /^(?:\+?254|0)?(7\d{8}|1\d{8})$/;

export function normaliseMsisdn(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  const m = cleaned.match(KE_MOBILE);
  if (!m) return null;
  return `+254${m[1]}`;
}

export function formatMsisdn(e164: string): string {
  const d = e164.replace('+254', '0');
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

/** Last three digits only, for display in admin. */
export function maskMsisdn(e164: string): string {
  return `07** *** ${e164.slice(-3)}`;
}

export const msisdnSchema = z
  .string()
  .trim()
  .min(9, 'Enter a phone number')
  .transform((v, ctx) => {
    const n = normaliseMsisdn(v);
    if (!n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'That does not look like a Kenyan mobile number',
      });
      return z.NEVER;
    }
    return n;
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code is six digits');
