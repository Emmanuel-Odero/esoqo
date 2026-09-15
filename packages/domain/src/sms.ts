/**
 * SMS text mechanics — encoding, segment counting, and the helpers every
 * piece of SMS copy in this repo is built out of.
 *
 * ## Why this module exists
 *
 * A GSM operator bills per *segment*, not per message, and the segment
 * size depends on the alphabet the message happens to use:
 *
 *   GSM-7  - 160 chars single, 153 per part once it splits
 *   UCS-2  -  70 chars single,  67 per part once it splits
 *
 * The trap is that a message is UCS-2 if **one single character** falls
 * outside GSM 03.38. An em dash is such a character. So is a curly
 * apostrophe, an ellipsis, a middot, a non-breaking space - every
 * character a word processor or a design-minded developer reaches for
 * by default. One em dash in a 90-character message silently turns it
 * into two UCS-2 parts: double the cost, and on older handsets two
 * separate texts that can arrive out of order.
 *
 * That is not a theoretical risk here. Before this module existed, four
 * of this repo's six SMS templates signed off with an em dash and every
 * one of them was shipping as 2-3 UCS-2 segments.
 *
 * ## How to use it
 *
 * Compose copy with `sms` (a tagged template). It runs `gsmSafe` over
 * the finished string, interpolations included, so an em dash typed
 * into copy - or a curly quote pasted into an org name by a user -
 * degrades to its ASCII twin instead of blowing up the encoding:
 *
 * ```ts
 * sms`Asante ${who}! Your ${smsKes(n)} to ${fit(campaign, 40)} is confirmed.`
 * ```
 *
 * Clamp every *variable* field with `fit`. A campaign title is validated
 * at 160 characters (jamii.ts) and an org name at 160 - either one alone
 * can overrun a whole message. Copy that only fits when the user's data
 * happens to be short is copy that fragments in production.
 *
 * Tests assert the worst case: sms.test.ts renders every template with
 * maximum-length inputs and requires `smsSegments() === 1`.
 */

/**
 * GSM 03.38 basic character set. Each of these costs one septet.
 * `\n` and `\r` are included; the escape character is not representable
 * here and is handled via GSM7_EXTENDED below.
 */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅå'
  + 'Δ_ΦΓΛΩΠΨΣΘΞ'
  + 'ÆæßÉ'
  + ' !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§'
  + '¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

/**
 * The GSM 03.38 extension table. Representable, but each costs *two*
 * septets (an escape plus the character), which is why `smsUnits`
 * counts rather than merely measuring `.length`.
 */
const GSM7_EXTENDED = new Set('^{}\\[~]|€');

/**
 * Non-GSM characters that show up in real copy and real user input,
 * mapped to the GSM-7 equivalent that carries the same meaning.
 *
 * Built from code points rather than written as literals on purpose:
 * half of these characters are invisible or indistinguishable from
 * ASCII in an editor, and a table whose keys you cannot see is a table
 * nobody can safely edit.
 *
 * Every entry is a *typographic* substitution - a dash for a dash, a
 * quote for a quote. Nothing here changes what a message says.
 */
const TRANSLITERATIONS: Record<string, string> = {};

function transliterate(codePoints: number[], to: string): void {
  for (const cp of codePoints) TRANSLITERATIONS[String.fromCodePoint(cp)] = to;
}

// Dashes: hyphen, non-breaking hyphen, figure/en/em dash, horizontal
// bar, minus sign. The em dash (2014) is the one that was actually
// costing money in this codebase.
transliterate([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212], '-');
// Single quotes and apostrophes, including the prime often pasted for one.
transliterate([0x2018, 0x2019, 0x201a, 0x201b, 0x2032], "'");
// Double quotes, including guillemets and the double prime.
transliterate([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb], '"');
// Spaces that are not U+0020: NBSP, en/em/thin/hair quads, narrow NBSP.
transliterate([0x00a0, 0x2002, 0x2003, 0x2007, 0x2009, 0x200a, 0x202f], ' ');
// Zero-width characters and the BOM: no width, no GSM-7 twin, no loss.
transliterate([0x200b, 0x200c, 0x200d, 0xfeff], '');
// Bullets and the ellipsis.
transliterate([0x2022, 0x00b7, 0x2043], '-');
transliterate([0x2026], '...');
// Symbols with a conventional ASCII spelling.
transliterate([0x2122], '(TM)');
transliterate([0x00ae], '(R)');
transliterate([0x00a9], '(C)');
transliterate([0x00b0], ' deg');
transliterate([0x2190], '<-');
transliterate([0x2192], '->');
transliterate([0x21d2], '=>');
transliterate([0x00d7], 'x');
transliterate([0x00f7, 0x2044], '/');

/** How many GSM-7 septets `text` costs, or null if it is not GSM-7 at all. */
function gsm7Units(text: string): number | null {
  let units = 0;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) units += 1;
    else if (GSM7_EXTENDED.has(ch)) units += 2;
    else return null;
  }
  return units;
}

export type SmsEncoding = 'GSM-7' | 'UCS-2';

/** Which alphabet the carrier will pick for this exact string. */
export function smsEncoding(text: string): SmsEncoding {
  return gsm7Units(text) === null ? 'UCS-2' : 'GSM-7';
}

/**
 * Billable length: septets under GSM-7, UTF-16 code units under UCS-2
 * (so an astral-plane emoji correctly costs 2, not 1).
 */
export function smsUnits(text: string): number {
  const gsm = gsm7Units(text);
  if (gsm !== null) return gsm;
  let units = 0;
  for (const ch of text) units += (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return units;
}

/**
 * How many segments the carrier will bill for - the number that decides
 * both the invoice and whether the recipient gets one clean text or two
 * halves that may arrive out of order.
 */
export function smsSegments(text: string): number {
  const gsm = gsm7Units(text);
  if (gsm !== null) return gsm <= 160 ? 1 : Math.ceil(gsm / 153);
  const units = smsUnits(text);
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/** The one-segment budget for a given piece of text, in its own encoding. */
export function smsBudget(text: string): number {
  return smsEncoding(text) === 'GSM-7' ? 160 : 70;
}

/**
 * Forces `text` into GSM-7 so it can never be the reason a message
 * doubles in price.
 *
 * Typographic characters are transliterated (see TRANSLITERATIONS);
 * accented Latin is decomposed to its base letter; anything still left
 * over is **dropped**. Dropping is the right failure mode here and not
 * a cop-out: the alternative is letting one pasted emoji in a campaign
 * title turn a 150-character message into three UCS-2 parts for every
 * recipient, forever. A silently missing emoji costs nothing; a
 * silently tripled SMS bill and a fragmented notification cost real
 * money and real trust.
 *
 * Run this over *outgoing copy*, never over stored data - the emoji
 * stays in the database and on the web page, it just does not ride the
 * SMS.
 */
export function gsmSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    if (GSM7_BASIC.has(ch) || GSM7_EXTENDED.has(ch)) { out += ch; continue; }
    const sub = TRANSLITERATIONS[ch];
    if (sub !== undefined) { out += sub; continue; }
    // Decomposition catches accented Latin not worth listing by hand
    // (Vietnamese, say, or a combining mark pasted in from the web):
    // strip the marks and keep the base letter if GSM-7 has it.
    const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const s of stripped) if (GSM7_BASIC.has(s)) out += s;
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}

/**
 * Clamps a variable field - an org name, a campaign title, a person's
 * name - to a character budget, cutting on a word boundary so the
 * result still reads like language rather than a severed string.
 *
 * Appends nothing. A trailing "..." costs three of the very characters
 * we are rationing, and "Build the Kibera Community Library" reads
 * better than "Build the Kibera Community Lib...". The exception is a
 * single long word with no boundary worth cutting on, which is hard-cut.
 */
export function fit(text: string, maxChars: number): string {
  const clean = gsmSafe(text).trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  // Only respect the word boundary when it does not throw away most of
  // the budget - otherwise one long first word would leave us with ''.
  const trimmed = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[\s,;:.\-]+$/, '');
}

/**
 * Takes a person's full name down to the first name, for copy that
 * greets someone. "Asante Jane!" is both warmer and 13 characters
 * cheaper than "Asante Jane Wanjiku Kamau!".
 */
export function firstName(fullName: string, maxChars = 14): string {
  const first = gsmSafe(fullName).trim().split(/\s+/)[0] ?? '';
  return fit(first, maxChars);
}

/**
 * `KES 2,500` - the house money format for SMS. Whole shillings only:
 * cents on a notification are noise, and ".00" is three wasted
 * characters on every single send.
 */
export function smsKes(amountKes: number): string {
  return `KES ${Math.round(amountKes).toLocaleString('en-KE')}`;
}

/**
 * Tagged template for SMS copy. Collapses accidental whitespace (so
 * copy can be written across several source lines) and runs `gsmSafe`
 * over the finished string, interpolations included.
 */
export function sms(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += String(values[i] ?? '');
  });
  return gsmSafe(out).replace(/\s+/g, ' ').trim();
}
