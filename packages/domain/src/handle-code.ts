/**
 * The free, system-generated esoqo ID — a human-friendly replacement for
 * the old opaque `ESK-4471-KE` shape (see pay-code.ts). Nobody types their
 * own handle from scratch: it is built from the names given at
 * registration, and the person only ever picks among a few system-built
 * candidates (see generateHandleCandidates) — never free text.
 *
 * A person who wants something nicer than these — their full name with
 * no digits, a chosen digit string, their phone number, or their email —
 * buys it instead (see EsoqoIdPurchase in schema.prisma). This file only
 * ever produces the free, non-premium shape.
 */
import { randomAlphabetString } from './random-code';

const DIGIT_ALPHABET = '0123456789';
/** How many digits close out every generated handle. */
export const HANDLE_DIGIT_LENGTH = 3;
/** The mnemonic part (letters only, before the digits) is capped here so
 *  the whole handle — mnemonic + digits — never exceeds 11 characters:
 *  8 for the name, 3 system-generated. Keeps it typeable and SMS-friendly
 *  even for someone with a long legal name, and short enough to read back
 *  over a phone call. */
const MAX_MNEMONIC_LENGTH = 8;
/** How many distinct candidates to offer someone at handle-selection time. */
export const HANDLE_CANDIDATE_COUNT = 3;

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
 * Merges a primary name with a secondary one into a single readable
 * mnemonic word, capped at MAX_MNEMONIC_LENGTH — this is the
 * "concatenate the names into one word" rule: rather than a long base
 * name with a couple of random letters tacked on, both names contribute
 * a real, front-anchored chunk of themselves, biased to keep the
 * primary name as intact as possible. e.g. "john" + "mutuku" -> "johnmutu".
 * With only one usable name, that name alone is clipped to fit.
 */
function buildMnemonic(primary: string, secondary?: string): string {
  if (!secondary) return primary.slice(0, MAX_MNEMONIC_LENGTH);

  const minSecondary = Math.min(2, secondary.length);
  const primaryBudget = Math.max(1, MAX_MNEMONIC_LENGTH - minSecondary);
  const primaryPart = primary.slice(0, Math.min(primary.length, primaryBudget));
  const secondaryBudget = MAX_MNEMONIC_LENGTH - primaryPart.length;
  const secondaryPart = secondary.slice(0, Math.max(0, secondaryBudget));
  return `${primaryPart}${secondaryPart}`;
}

/**
 * Builds a candidate free esoqo ID from 1-3 official names.
 *
 * Picks one name at random as the primary, then — when another name was
 * given — merges it with a second, different name into one readable
 * mnemonic word via buildMnemonic, and finally appends
 * HANDLE_DIGIT_LENGTH system-generated digits. e.g. names
 * ["John", "Mutuku", "Kamau"] might yield "johnmutu482".
 *
 * This is a *candidate*, exactly like mintEsoqoCode() — it is not checked
 * against the database. The caller owns the unique constraint and retry
 * (see allocateEsoqoHandle in packages/db/src/dal/payment-id.ts), and
 * generateHandleCandidates below is what actually offers someone a
 * choice among several of these.
 */
export function generateSystemHandle(names: string[]): string {
  const cleaned = names.map(cleanName).filter((n) => n.length > 0);
  if (cleaned.length === 0) {
    throw new Error('generateSystemHandle needs at least one name');
  }

  const primaryIndex = randomIndex(cleaned.length);
  const others = cleaned.filter((_, i) => i !== primaryIndex);
  const secondary = others.length > 0 ? others[randomIndex(others.length)] : undefined;
  const mnemonic = buildMnemonic(cleaned[primaryIndex]!, secondary);

  const digits = randomAlphabetString(DIGIT_ALPHABET, HANDLE_DIGIT_LENGTH);
  return `${mnemonic}${digits}`;
}

/**
 * Offers up to `count` distinct handle candidates for a person to choose
 * from at registration/handle-application time — this is the "show three
 * options, they pick one" step. Candidates are plain generateSystemHandle
 * calls, de-duplicated by re-rolling; none are reserved or checked
 * against the database yet, that only happens once one is chosen (see
 * allocateChosenEsoqoHandle in packages/db/src/dal/payment-id.ts).
 */
export function generateHandleCandidates(
  names: string[], count: number = HANDLE_CANDIDATE_COUNT,
): string[] {
  const candidates = new Set<string>();
  const maxAttempts = count * 20;
  for (let attempt = 0; candidates.size < count && attempt < maxAttempts; attempt++) {
    candidates.add(generateSystemHandle(names));
  }
  return [...candidates];
}

/** Whether a string is shaped like a free system-generated handle —
 *  lowercase letters followed by HANDLE_DIGIT_LENGTH digits. Shape only,
 *  same caveat as isEsoqoIdShape: this answers "could this be one", the
 *  database answers "is this one". */
export function isSystemHandleShape(raw: string): boolean {
  const re = new RegExp(`^[a-z]{2,${MAX_MNEMONIC_LENGTH}}[0-9]{${HANDLE_DIGIT_LENGTH}}$`);
  return re.test(raw.trim().toLowerCase());
}
