/**
 * Best-effort field extraction from OCR text run over a photographed
 * Kenyan national ID (front and back). This is deliberately a pure
 * string→fields function — the OCR engine itself (client-side, run in
 * the browser) is the caller's concern, this only has to cope with
 * whatever ragged, misread text that engine hands back.
 *
 * "Best-effort" is not a caveat to apologise for — it is the design.
 * Every field this returns is meant to prefill an editable form field,
 * never to be written straight to a record. A legal ID is exactly the
 * kind of document nobody should trust OCR on blindly (see
 * NationalIdRecord's own doc comment in schema.prisma).
 */

export interface ParsedNationalId {
  firstName?: string;
  middleName?: string;
  surname?: string;
  idNumber?: string;
  serialNumber?: string;
  sex?: string;
  districtOfBirth?: string;
  /** ISO 8601 date (YYYY-MM-DD), when a parseable date was found. */
  dateOfBirth?: string;
  /** ISO 8601 date (YYYY-MM-DD), when a parseable date was found. */
  dateOfIssue?: string;
}

/** Kenyan IDs print dates as DD.MM.YYYY (sometimes DD-MM-YYYY or DD/MM/YYYY,
 *  and OCR often confuses the separator entirely) — this matches any of
 *  those and normalises to ISO. */
const DATE_RE = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/;

function toIsoDate(match: RegExpMatchArray | null): string | undefined {
  if (!match) return undefined;
  const [, d, m, y] = match;
  const day = d!.padStart(2, '0');
  const month = m!.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return undefined;
  return `${y}-${month}-${day}`;
}

function lines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Finds a label line and returns the next non-empty line after it —
 *  the shape every field on a Kenyan ID follows (label, then value, on
 *  separate lines). Tries the same line too, in case OCR ran label and
 *  value together separated only by whitespace. */
function valueAfterLabel(ls: string[], labelPattern: RegExp): string | undefined {
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]!;
    const match = line.match(labelPattern);
    if (!match) continue;
    const rest = line.slice((match.index ?? 0) + match[0].length).trim();
    if (rest) return rest;
    const next = ls[i + 1];
    if (next && !labelPattern.test(next)) return next;
  }
  return undefined;
}

/** Splits a "FULL NAMES" value into first/middle/surname the way this
 *  product captures them elsewhere (see WalkInFlow, completeRegistration)
 *  — first word first name, last word surname, anything between is the
 *  middle name. Kenyan IDs print names in that order. */
function splitFullNames(full: string): Pick<ParsedNationalId, 'firstName' | 'middleName' | 'surname'> {
  const words = full.replace(/[^A-Za-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  if (words.length === 1) return { firstName: capitalise(words[0]!) };
  const [first, ...rest] = words;
  const surname = rest.pop()!;
  return {
    firstName: capitalise(first!),
    middleName: rest.length ? capitalise(rest.join(' ')) : undefined,
    surname: capitalise(surname),
  };
}

function capitalise(word: string): string {
  return word
    .split(' ')
    .map((w) => (w.length > 1 ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}

export function parseKenyanIdText(rawText: string): ParsedNationalId {
  const ls = lines(rawText);
  const result: ParsedNationalId = {};

  const fullNames = valueAfterLabel(ls, /FULL\s*NAMES?/i);
  if (fullNames) Object.assign(result, splitFullNames(fullNames));

  const dobLine = valueAfterLabel(ls, /DATE\s*OF\s*BIRTH/i);
  result.dateOfBirth = toIsoDate(dobLine?.match(DATE_RE) ?? null);

  const issueLine = valueAfterLabel(ls, /DATE\s*OF\s*ISSUE/i);
  result.dateOfIssue = toIsoDate(issueLine?.match(DATE_RE) ?? null);

  const sexLine = valueAfterLabel(ls, /\bSEX\b/i);
  if (sexLine) {
    const s = sexLine.trim().toUpperCase();
    if (s.startsWith('M')) result.sex = 'MALE';
    else if (s.startsWith('F')) result.sex = 'FEMALE';
  }

  const district = valueAfterLabel(ls, /DISTRICT\s*OF\s*BIRTH/i);
  if (district) result.districtOfBirth = capitalise(district.replace(/[^A-Za-z\s'-]/g, '').trim());

  // ID number: an 8-digit run, ideally near a line mentioning "ID NUMBER" /
  // "SERIAL NUMBER" — but OCR often drops the label, so this also accepts
  // any bare 8-digit run as a fallback candidate.
  const idNearLabel = valueAfterLabel(ls, /ID\s*NUMBER/i);
  const idDigits = (idNearLabel ?? rawText).match(/\b\d{7,8}\b/);
  if (idDigits) result.idNumber = idDigits[0];

  const serialNearLabel = valueAfterLabel(ls, /SERIAL\s*NUMBER/i);
  const serialDigits = (serialNearLabel ?? '').match(/\b\d{6,10}\b/)
    ?? rawText.match(/\bSERIAL[^\d]{0,10}(\d{6,10})\b/i);
  if (serialDigits) result.serialNumber = serialDigits[serialDigits.length === 2 ? 1 : 0];

  return result;
}
