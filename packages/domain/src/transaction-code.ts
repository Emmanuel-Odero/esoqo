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
  RECEIPT: 'RC',
} as const;

export type TransactionCodeKind = (typeof TRANSACTION_CODE_KINDS)[keyof typeof TRANSACTION_CODE_KINDS];

/**
 * What each kind is, in a sentence a stranger can act on. The two-letter
 * prefix is deliberately self-describing (see TRANSACTION_CODE_KINDS),
 * which only pays off if something turns it back into words — this is
 * what the /verify page uses to answer "I typed a BP- code, what do I do
 * with that?" instead of the far less useful "no certificate with that
 * code," which is what any lookup that only knows about receipts and
 * certificates would say.
 */
export const TRANSACTION_CODE_KIND_LABELS: Record<TransactionCodeKind, string> = {
  [TRANSACTION_CODE_KINDS.WALLET_TOPUP]: 'a wallet top-up',
  [TRANSACTION_CODE_KINDS.WALLET_WITHDRAWAL]: 'a wallet withdrawal',
  [TRANSACTION_CODE_KINDS.WALLET_TRANSFER]: 'an Esoqo transfer',
  [TRANSACTION_CODE_KINDS.BUSINESS_PAYMENT]: 'a business payment',
  [TRANSACTION_CODE_KINDS.DONATION]: 'a donation',
  [TRANSACTION_CODE_KINDS.PARKING]: 'a parking payment',
  [TRANSACTION_CODE_KINDS.RECEIPT]: 'a receipt',
};

/** The kind a code names, read off its first two characters — or null
 *  when it isn't a transaction code at all. Reads the prefix directly
 *  rather than going through isTransactionCodeValid, because a lookup
 *  that has to decide *which table to search* needs the kind to be
 *  knowable even from a mistyped code: the checksum is a typo-catcher,
 *  not a router, and routing on it means a single mistyped character
 *  sends a shopper to the wrong lookup entirely. */
export function transactionCodeKind(raw: string): TransactionCodeKind | null {
  const prefix = raw.trim().toUpperCase().slice(0, 2);
  const kinds: string[] = Object.values(TRANSACTION_CODE_KINDS);
  return kinds.includes(prefix) ? (prefix as TransactionCodeKind) : null;
}

const ENTROPY_LENGTH = 5;

/**
 * Digits plus the same unambiguous letters/digits the entropy block
 * draws from — one alphabet so the checksum can walk every character in
 * KIND+DATE+ENTROPY, not just the letters.
 *
 * `'01' + UNAMBIGUOUS_ALPHABET` rather than `'0123456789' +
 * UNAMBIGUOUS_ALPHABET`: the latter (this file's original version) is a
 * 41-CHARACTER STRING with only 33 DISTINCT characters — '2'..'9' each
 * appear twice, once in the leading digit run and again inside
 * UNAMBIGUOUS_ALPHABET. `indexOf` always resolves to the first
 * occurrence, so that duplication was harmless for reading a character
 * IN (every real character still gets one fixed index); the bug was
 * checkChar rendering its OUTPUT through that same 41-slot string —
 * `sum % 41` landing on residue r (2..9) and residue r+31 both render
 * the identical digit, so two different sums alias to the same check
 * character. Measured: ~1% of single-character mistypes were silently
 * accepted. The fix below is this 33-unique-character alphabet
 * (digits '0' and '1' aren't in UNAMBIGUOUS_ALPHABET, so `'01' + ...`
 * has no repeats) plus a modulus and weighting scheme sized to it — see
 * checkChar.
 */
const CHECKSUM_ALPHABET = `01${UNAMBIGUOUS_ALPHABET}`;
const CHECKSUM_MODULUS = CHECKSUM_ALPHABET.length; // 33 — every character in it is unique.

/**
 * Per-position weights for checkChar, each coprime to CHECKSUM_MODULUS
 * (33 = 3 × 11, so anything not a multiple of 3 or 11). `body` is never
 * longer than 13 (KIND 2 + DATE 6 + ENTROPY 5), so 13 entries is enough
 * without cycling.
 */
const CHECKSUM_WEIGHTS = [1, 2, 4, 5, 7, 8, 10, 13, 14, 16, 17, 19, 20];

/**
 * Position-weighted sum of `body` mod CHECKSUM_MODULUS. Not a
 * cryptographic MAC — its only job is catching the kind of
 * single-character slip or adjacent swap a person makes reading a code
 * off a phone screen or typing it into a USSD prompt.
 *
 * Deliberately *not* a Luhn-style "double every other digit, fold if
 * over the base" transform, even though that is the classic answer:
 * Luhn's fold step (subtract base-1 when the doubled value overflows)
 * only happens to be an injective map of the digit space for base 10 —
 * it is not injective in general (a first attempt at this used it and a
 * test caught a real blind spot: two different characters at the same
 * position could produce the same folded value).
 *
 * The guarantee here: `idx(body[i])` always lands in `[0, MODULUS-1]`
 * (CHECKSUM_ALPHABET has exactly MODULUS unique characters — see its
 * own comment for why the previous version's 41-slot, 33-symbol
 * version broke this), and CHECKSUM_WEIGHTS[i] is coprime to MODULUS,
 * hence invertible mod MODULUS. So for any two distinct indices a≠b in
 * that range, `(a-b) * weight mod MODULUS` is nonzero — a≡b would be
 * required, and a,b are both already in-range and unequal — meaning
 * changing the character at any one position always changes `sum mod
 * MODULUS`, unconditionally, not just for a sampled set of weights.
 */
function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const idx = CHECKSUM_ALPHABET.indexOf(body[i]!);
    if (idx === -1) continue; // shouldn't happen; skip rather than throw on odd input
    sum += idx * CHECKSUM_WEIGHTS[i % CHECKSUM_WEIGHTS.length]!;
  }
  return CHECKSUM_ALPHABET[sum % CHECKSUM_MODULUS]!;
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

/** Shape only, no checksum — "could this be one", not "is this one
 *  correct". Exported because a page that echoes the code it was handed
 *  (the /verify/[code] heading) needs exactly this weaker question: a
 *  mistyped code should still be shown back to the person who mistyped
 *  it, but an arbitrary URL path segment must not be rendered as if it
 *  were a credential. isTransactionCodeValid below answers the stronger
 *  question and is the wrong tool for that. */
export function isTransactionCodeShape(raw: string): boolean {
  return SHAPE.test(raw.trim().toUpperCase());
}

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
