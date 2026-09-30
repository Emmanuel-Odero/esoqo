/**
 * The one place every money-movement's customer-facing reference code is
 * generated — what shows up in an SMS receipt, what support asks a caller
 * to read back, what reconciliation matches against. Before this, three
 * call sites each grew their own: donation.ts drew from `Math.random()`
 * over a 10,000-value space (the exact "guessable, low-entropy" mistake a
 * financial reference must not make), business-payment.ts used
 * `randomBytes(5).toString('hex')` (fine entropy, but no date component,
 * not sortable, no check digit, and its own hand-rolled prefix), and
 * wallet top-ups, withdrawals and internal transfers had no reference at
 * all. One generator means one thing to get right.
 *
 * Format: `<KIND><YYMMDD><5-char entropy><check char>`, e.g.
 * `WT2609298KX3FQ` — 14 characters, no separators. Every field is
 * fixed-width, so a hyphen buys readability but no information; dropping
 * it shortens every SMS receipt by three characters for free, and
 * isTransactionCodeValid below parses by position instead of by split.
 *
 *  - KIND (2 letters): which product line minted this — see
 *    TRANSACTION_CODE_KINDS below. Every call site names its own kind
 *    rather than reusing another's, so a code is self-describing without
 *    a database lookup.
 *  - YYMMDD: plain numeric date, not a letter-coded scheme. A scheme that
 *    maps several months to the same letter (as a first draft of this
 *    proposed) is lossy — it can't be verified or sorted back to a real
 *    date — which defeats the point of putting a date in the code at all.
 *  - 5-char entropy: drawn from UNAMBIGUOUS_ALPHABET via
 *    randomAlphabetString (random-code.ts) — the same CSPRNG,
 *    rejection-sampled, confusable-character-free machinery
 *    pay-code.ts/handle-code.ts already use for the same reason: this is
 *    a credential-shaped value, not a display nicety. 31^5 ≈ 28.6M
 *    combinations per kind per day is generous for any realistic daily
 *    volume this platform sees.
 *  - check char: a Luhn-style weighted checksum over KIND+DATE+ENTROPY,
 *    so a single mistyped or transposed character read off an SMS or
 *    typed into a support form is caught instantly, before it can match
 *    (or fail to match) the wrong record.
 *
 * This never checks uniqueness — like mintEsoqoCode and
 * generateSystemHandle, it returns a *candidate*. The caller owns the
 * database's unique constraint and the retry-on-collision loop (see
 * generateUniqueTransactionCode below), the same "let the database
 * arbitrate" rule allocateEsoqoCode follows.
 */
import { randomAlphabetString, UNAMBIGUOUS_ALPHABET } from './random-code';

/** Which product line minted a code — kept as a flat list rather than a
 *  per-model enum so a support agent can read the first two letters of
 *  any reference and know what it was for without a database lookup. */
export const TRANSACTION_CODE_KINDS = {
  WALLET_TOPUP: 'WT',
  WALLET_WITHDRAWAL: 'WD',
  WALLET_TRANSFER: 'TR',
  BUSINESS_PAYMENT: 'BP',
  DONATION: 'DN',
  PARKING: 'PK',
} as const;

export type TransactionCodeKind = (typeof TRANSACTION_CODE_KINDS)[keyof typeof TRANSACTION_CODE_KINDS];

const ENTROPY_LENGTH = 5;

/** Digits plus the same unambiguous letters/digits the entropy block
 *  draws from — one alphabet so the checksum can walk every character in
 *  KIND+DATE+ENTROPY, not just the letters. */
const CHECKSUM_ALPHABET = `0123456789${UNAMBIGUOUS_ALPHABET}`;

/**
 * Position-weighted sum of `body` mod 41 (CHECKSUM_ALPHABET.length).
 * Not a cryptographic MAC — its only job is catching the kind of
 * single-character slip or adjacent swap a person makes reading a code
 * off a phone screen or typing it into a USSD prompt.
 *
 * Deliberately *not* a Luhn-style "double every other digit, fold if
 * over the base" transform, even though that is the classic answer:
 * Luhn's fold step (subtract base-1 when the doubled value overflows)
 * only happens to be an injective map of the digit space for base 10 —
 * it is not injective in general, and isn't for our 41-symbol alphabet
 * (a first attempt at this used it and a test caught a real blind spot:
 * two different characters at the same position could produce the same
 * folded value, so swapping between them left the checksum unchanged).
 * A plain per-position weight avoids the fold entirely. Because 41 is
 * prime, every weight 1..40 is automatically coprime to it, which
 * guarantees changing any single character changes `sum mod 41` — no
 * silent blind spot, and no case-by-case proof needed per weight.
 */
function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const idx = CHECKSUM_ALPHABET.indexOf(body[i]!);
    if (idx === -1) continue; // shouldn't happen; skip rather than throw on odd input
    sum += idx * (i + 1);
  }
  return CHECKSUM_ALPHABET[sum % CHECKSUM_ALPHABET.length]!;
}

function datePart(date: Date): string {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * Mints one reference code candidate. `date` defaults to now and only
 * ever needs overriding in tests — every real caller wants "today."
 */
export function generateTransactionCode(kind: TransactionCodeKind, date: Date = new Date()): string {
  const day = datePart(date);
  const entropy = randomAlphabetString(UNAMBIGUOUS_ALPHABET, ENTROPY_LENGTH);
  const body = `${kind}${day}${entropy}`;
  return `${body}${checkChar(body)}`;
}

const KIND_LEN = 2;
const DATE_LEN = 6;
const TOTAL_LEN = KIND_LEN + DATE_LEN + ENTROPY_LENGTH + 1; // 14

const SHAPE = new RegExp(
  `^[A-Z]{${KIND_LEN}}[0-9]{${DATE_LEN}}[${UNAMBIGUOUS_ALPHABET}]{${ENTROPY_LENGTH}}[${CHECKSUM_ALPHABET}]$`,
);

/** Shape *and* checksum — unlike isSystemHandleShape/isEsoqoIdShape,
 *  which only answer "could this be one," a transaction code carries
 *  enough of itself to be verified without a database round trip. Still
 *  not a substitute for the lookup (a checksum can't tell you the code
 *  was ever actually issued), but it lets a support form or USSD prompt
 *  reject a mistyped code before it ever reaches the database. */
export function isTransactionCodeValid(raw: string): boolean {
  const trimmed = raw.trim().toUpperCase();
  if (!SHAPE.test(trimmed)) return false;
  const body = trimmed.slice(0, TOTAL_LEN - 1);
  const check = trimmed.slice(TOTAL_LEN - 1);
  return checkChar(body) === check;
}
