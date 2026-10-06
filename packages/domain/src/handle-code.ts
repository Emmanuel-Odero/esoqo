/**
 * The free, system-generated esoqo ID — the human-friendly handle that
 * replaced the old opaque `ESK-4471-KE` shape. Nobody types their own
 * handle from scratch: it is built from the names given at registration,
 * and the person only ever picks among a few system-built candidates (see
 * generateHandleCandidates) — never free text.
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
/** The floor the shape check enforces — two letters before the digits. */
const MIN_MNEMONIC_LENGTH = 2;
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

/**
 * Whether a string is shaped like a free system-generated handle —
 * lowercase letters followed by HANDLE_DIGIT_LENGTH digits. Shape only,
 * same caveat as isEsoqoIdShape: this answers "could this be one", the
 * database answers "is this one".
 */
export function isSystemHandleShape(raw: string): boolean {
  const re = new RegExp(`^[a-z]{${MIN_MNEMONIC_LENGTH},${MAX_MNEMONIC_LENGTH}}[0-9]{${HANDLE_DIGIT_LENGTH}}$`);
  return re.test(raw.trim().toLowerCase());
}

/** How many distinct digit tails each mnemonic gets before the mint moves
 *  on to the next candidate. Mirrors handlecode.digitsPerMnemonic. */
export const DIGITS_PER_MNEMONIC = 8;

/** A fresh HandleDigitLength-digit tail. Mirrors
 *  handlecode.RandomHandleDigits. */
export function randomHandleDigits(): string {
  return randomAlphabetString(DIGIT_ALPHABET, HANDLE_DIGIT_LENGTH);
}

/**
 * Merges a primary name with a secondary one into a single readable
 * mnemonic word, capped at MAX_MNEMONIC_LENGTH.
 *
 * Exported for parity with handlecode.BuildMnemonic, whose tests pin the
 * same budget arithmetic — the two must agree exactly or a handle minted
 * on one platform fails the other's shape assumptions.
 */
export function buildMnemonic(primary: string, secondary?: string): string {
  if (!secondary) return primary.slice(0, MAX_MNEMONIC_LENGTH);

  const minSecondary = Math.min(2, secondary.length);
  const primaryBudget = Math.max(1, MAX_MNEMONIC_LENGTH - minSecondary);
  const primaryPart = primary.slice(0, Math.min(primary.length, primaryBudget));
  const secondaryBudget = MAX_MNEMONIC_LENGTH - primaryPart.length;
  const secondaryPart = secondary.slice(0, Math.max(0, secondaryBudget));
  return `${primaryPart}${secondaryPart}`;
}

/**
 * The handle mnemonics a person's names yield, most specific first.
 *
 * generateSystemHandle picks the primary and secondary name at random,
 * which is right when a human is choosing from the options but wrong for
 * the automatic mint: every retry could pick the same saturated mnemonic,
 * so a crowded name pair would burn the whole budget while the other
 * orderings ("kamaujoh" when "johnkama" is taken) sat unused. Enumerating
 * them makes the mint escalate instead of retrying blind.
 *
 * The merged pair is tried before the bare names because a merged mnemonic
 * is the more identifying one — "johnkama" says more than "john" — and a
 * bare name is a graceful last resort once the pair space is full.
 *
 * Mirrors handlecode.PersonHandleCandidates.
 */
export function personHandleCandidates(names: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const name of names) {
    const c = cleanName(name);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    cleaned.push(c);
  }
  if (cleaned.length === 0) return [];

  const out: string[] = [];
  const add = (value: string) => {
    const clipped = value.slice(0, MAX_MNEMONIC_LENGTH);
    if (clipped.length < MIN_MNEMONIC_LENGTH || out.includes(clipped)) return;
    out.push(clipped);
  };
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = 0; j < cleaned.length; j++) {
      if (i !== j) add(buildMnemonic(cleaned[i]!, cleaned[j]!));
    }
  }
  for (const name of cleaned) add(name);
  return out;
}

/** Function words dropped before a group or business name becomes a
 *  mnemonic. "Mchama wa Wananchi" reads as "mchamawanan..." if the "wa" is
 *  left in to be merged with its neighbour, and Swahili function words
 *  cluster exactly where an English reader's would, so they have to come
 *  out before any clipping happens. Only function words are listed — never
 *  a noun, however generic, because "society" or "group" is often the most
 *  identifying word an org has. */
const ORG_STOPWORDS = new Set([
  'wa', 'za', 'ya', 'la', 'na', 'kwa', 'cha', 'vya', 'kama', 'au',
  'the', 'of', 'and', 'for', 'a', 'an', 'in', 'on', 'at', 'to',
]);

/**
 * The handle mnemonics an organisation's name yields, in the order they
 * should be tried.
 *
 * A group name is a phrase, and the two-name merge cannot take one: it
 * clips the second name to two letters, and "Wananchi"[:2] is "wa" — so
 * "Mchama wa Wananchi" minted "mchamawa482", a handle containing the very
 * stopword the merge was supposed to drop. Merging two words necessarily
 * cuts one of them mid-token, so this never does that up front.
 *
 * Instead each token is offered whole first, in order, and only the unused
 * 1,000 three-digit tails of those are tried before any token is cut. That
 * ordering also handles the case where the leading word is simply not
 * distinctive enough: Kenyan group names lead with "chama" or "jamii"
 * often enough that a thousand numeric suffixes would not cover them, so a
 * saturated "chama###" falls through to the next token ("wananchi")
 * instead of failing the mint or bloating the handle into word-soup.
 *
 * knownAs is consulted only when officialName yields nothing usable, since
 * it is the less formal of the two.
 *
 * Mirrors handlecode.OrgMnemonicCandidates.
 */
export function orgHandleCandidates(officialName: string, knownAs?: string | null): string[] {
  for (const name of [officialName, knownAs]) {
    const candidates = orgHandleCandidatesFrom(name);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

function orgHandleCandidatesFrom(name?: string | null): string[] {
  if (!name) return [];
  // Split on whitespace and punctuation before cleaning: cleaning first
  // would glue "Mchama wa Wananchi" into one token and leave the stopword
  // filter with nothing to recognise.
  const raw = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (raw.length === 0) return [];

  let meaningful = raw.filter((token) => !ORG_STOPWORDS.has(token));
  if (meaningful.length === 0) {
    // A name made entirely of function words ("Wa Wa Wa") — keep the
    // original tokens rather than refusing to mint.
    meaningful = raw;
  }

  const out: string[] = [];
  const add = (value: string) => {
    const clipped = value.slice(0, MAX_MNEMONIC_LENGTH);
    if (clipped.length < MIN_MNEMONIC_LENGTH || out.includes(clipped)) return;
    out.push(clipped);
  };
  for (const token of meaningful) add(token);
  if (meaningful.length > 1) {
    add(meaningful.slice(0, 2).join(''));
    add(meaningful.join(''));
  }
  return out;
}

/**
 * Walks a list of pre-derived mnemonics, re-rolling each one's digit tail
 * until `done` reports the insert landed. Returns the handle and true on
 * success, or ['', false] once every candidate is exhausted — the caller
 * surfaces the collision.
 *
 * `done` may be async — the real callers are database inserts — and a
 * candidate counts as landed only once it resolves true.
 *
 * Both mints funnel through here so the retry budget and escalation order
 * are decided in exactly one place. Mirrors handlecode.MintHandle.
 */
export async function mintHandle(
  candidates: string[],
  done: (candidate: string) => boolean | Promise<boolean>,
): Promise<[string, boolean]> {
  for (const mnemonic of candidates) {
    for (let attempt = 0; attempt < DIGITS_PER_MNEMONIC; attempt++) {
      const candidate = `${mnemonic}${randomHandleDigits()}`;
      if (await done(candidate)) return [candidate, true];
    }
  }
  return ['', false];
}
