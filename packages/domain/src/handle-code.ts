/**
 * The free, system-generated esoqo ID — a human-friendly replacement for
 * the old opaque `ESK-4471-KE` shape (see pay-code.ts). Nobody picks their
 * own handle: it is built from the names given at registration, with
 * randomness used only to keep two people with the same names from
 * colliding, never as something a person chooses or edits.
 *
 * A person who wants something nicer than the random handle below — their
 * full name with no digits, a chosen digit string, their phone number, or
 * their email — buys it instead (see EsoqoIdPurchase in schema.prisma).
 * This file only ever produces the free, non-premium shape.
 */
import { randomAlphabetString } from './random-code';

const DIGIT_ALPHABET = '0123456789';
/** How many digits close out every generated handle. */
export const HANDLE_DIGIT_LENGTH = 3;
/** A base name longer than this is clipped — keeps the handle typeable
 *  and SMS-friendly even for someone with a very long legal name. */
const MAX_BASE_LENGTH = 16;

function cleanName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Draws one CSPRNG-backed index into `[0, length)` — picking *which* name
 *  anchors the handle is still a credential-shaping decision, so this
 *  never uses Math.random, same rule pay-code.ts follows for the code
 *  itself. */
function randomIndex(length: number): number {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error('randomIndex needs a CSPRNG (globalThis.crypto.getRandomValues)');
  }
  const ceiling = 256 - (256 % length);
  for (;;) {
    const byte = webcrypto.getRandomValues(new Uint8Array(1))[0]!;
    if (byte < ceiling) return byte % length;
  }
}

/**
 * Builds a candidate free esoqo ID from 1-3 official names.
 *
 * Picks one name at random as the base, lowercases and clips it, then —
 * when another name was given — draws 1 or 2 letters off the front of a
 * different, unused name and appends them, and finally appends
 * HANDLE_DIGIT_LENGTH system-generated digits. e.g. names
 * ["John", "Mutuku", "Kamau"] might yield "mutukuka482".
 *
 * This is a *candidate*, exactly like mintEsoqoCode() — it is not checked
 * against the database. The caller owns the unique constraint and retry
 * (see allocateEsoqoHandle in packages/db/src/dal/payment-id.ts).
 */
export function generateSystemHandle(names: string[]): string {
  const cleaned = names.map(cleanName).filter((n) => n.length > 0);
  if (cleaned.length === 0) {
    throw new Error('generateSystemHandle needs at least one name');
  }

  const baseIndex = randomIndex(cleaned.length);
  const base = cleaned[baseIndex]!.slice(0, MAX_BASE_LENGTH);

  const others = cleaned.filter((_, i) => i !== baseIndex);
  let extra = '';
  if (others.length > 0) {
    const otherName = others[randomIndex(others.length)]!;
    const extraLen = Math.min(otherName.length, randomIndex(2) + 1); // 1 or 2
    extra = otherName.slice(0, extraLen);
  }

  const digits = randomAlphabetString(DIGIT_ALPHABET, HANDLE_DIGIT_LENGTH);
  return `${base}${extra}${digits}`;
}

/** Whether a string is shaped like a free system-generated handle —
 *  lowercase letters followed by HANDLE_DIGIT_LENGTH digits. Shape only,
 *  same caveat as isEsoqoIdShape: this answers "could this be one", the
 *  database answers "is this one". */
export function isSystemHandleShape(raw: string): boolean {
  const re = new RegExp(`^[a-z]{2,${MAX_BASE_LENGTH + 2}}[0-9]{${HANDLE_DIGIT_LENGTH}}$`);
  return re.test(raw.trim().toLowerCase());
}
