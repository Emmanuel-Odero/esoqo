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

import { COUNTIES, type County } from './counties';

export interface ParsedNationalId {
  firstName?: string;
  middleName?: string;
  surname?: string;
  idNumber?: string;
  serialNumber?: string;
  sex?: string;
  districtOfBirth?: string;
  /** "PLACE OF ISSUE" off the front of the card. Not stored anywhere on
   *  its own — it exists so a card whose district of birth OCR'd badly
   *  still has a second shot at resolving a county below. */
  placeOfIssue?: string;
  /** One of COUNTIES, derived from districtOfBirth/placeOfIssue — see
   *  countyForDistrict. Only ever set when the derivation is confident
   *  enough to be worth pre-selecting in a dropdown the person can change. */
  county?: County;
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
 *  middle name. Kenyan IDs print names in that order.
 *
 *  Exported because the same split is needed anywhere a single stored
 *  name string has to be poured back into the three-field form — most
 *  notably a chama invite, which only ever captured one `officialName`
 *  for the person the officer typed in. */
export function splitFullNames(full: string): Pick<ParsedNationalId, 'firstName' | 'middleName' | 'surname'> {
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

/**
 * Old district names that are not their own county today, mapped to the
 * county that absorbed them.
 *
 * A Kenyan ID prints the district that existed when the card was issued,
 * and the 1992-2010 districts were redrawn into the 47 counties this
 * product works in. So "DISTRICT OF BIRTH: THIKA" is a person from
 * Kiambu, and a form that can only match a district name against
 * COUNTIES verbatim leaves them picking their own county by hand for no
 * reason.
 *
 * Deliberately partial, and deliberately conservative. Districts whose
 * name simply became the county name (Nairobi, Mombasa, Kisumu, Nakuru,
 * Kiambu…) are not listed — they match COUNTIES directly. Districts that
 * were genuinely split across two counties are also not listed: a
 * coin-flip prefill on someone's own county is worse than no prefill,
 * because a correct-looking dropdown is the one nobody re-reads.
 * Everything here is a district that lands wholly inside one county.
 */
const DISTRICT_TO_COUNTY: Record<string, County> = {
  // Kiambu
  Thika: 'Kiambu', Kikuyu: 'Kiambu', Limuru: 'Kiambu', Githunguri: 'Kiambu',
  Gatundu: 'Kiambu', Gatanga: 'Kiambu', Ruiru: 'Kiambu', Lari: 'Kiambu', Juja: 'Kiambu',
  // Murang'a
  Kangema: "Murang'a", Kigumo: "Murang'a", Kiharu: "Murang'a", Kandara: "Murang'a",
  Maragua: "Murang'a", Kahuro: "Murang'a",
  // Nyeri
  Othaya: 'Nyeri', Mukurweini: 'Nyeri', Tetu: 'Nyeri', Mathira: 'Nyeri', Kieni: 'Nyeri',
  // Nyandarua
  'Ol Kalou': 'Nyandarua', Olkalou: 'Nyandarua', Kinangop: 'Nyandarua', Ndaragwa: 'Nyandarua',
  // Nakuru
  Molo: 'Nakuru', Naivasha: 'Nakuru', Njoro: 'Nakuru', Gilgil: 'Nakuru', Rongai: 'Nakuru',
  Subukia: 'Nakuru', Kuresoi: 'Nakuru',
  // Uasin Gishu
  Eldoret: 'Uasin Gishu', Wareng: 'Uasin Gishu', Kesses: 'Uasin Gishu',
  // Elgeyo Marakwet
  Iten: 'Elgeyo Marakwet', Keiyo: 'Elgeyo Marakwet', Marakwet: 'Elgeyo Marakwet',
  Kapsowar: 'Elgeyo Marakwet',
  // Nandi
  Kapsabet: 'Nandi', Nandi: 'Nandi', Aldai: 'Nandi', Tinderet: 'Nandi', Mosop: 'Nandi',
  // Trans Nzoia
  Kitale: 'Trans Nzoia', Kwanza: 'Trans Nzoia', Endebess: 'Trans Nzoia', Cherangany: 'Trans Nzoia',
  // West Pokot
  Kapenguria: 'West Pokot', Pokot: 'West Pokot', Sigor: 'West Pokot', Kacheliba: 'West Pokot',
  // Turkana
  Lodwar: 'Turkana', Turkana: 'Turkana', Lokitaung: 'Turkana', Lokichoggio: 'Turkana',
  // Baringo
  Kabarnet: 'Baringo', Marigat: 'Baringo', Eldama: 'Baringo', 'Eldama Ravine': 'Baringo',
  // Samburu
  Maralal: 'Samburu', Samburu: 'Samburu',
  // Laikipia
  Nanyuki: 'Laikipia', Rumuruti: 'Laikipia',
  // Bomet / Kericho
  Sotik: 'Bomet', Chepalungu: 'Bomet', Konoin: 'Bomet',
  Kipkelion: 'Kericho', Londiani: 'Kericho', Bureti: 'Kericho', Belgut: 'Kericho',
  // Bungoma
  Webuye: 'Bungoma', Kimilili: 'Bungoma', Sirisia: 'Bungoma', Bumula: 'Bungoma',
  'Mount Elgon': 'Bungoma', Kanduyi: 'Bungoma',
  // Busia
  Nambale: 'Busia', Butula: 'Busia', Samia: 'Busia', Teso: 'Busia', Budalangi: 'Busia',
  // Kakamega
  Mumias: 'Kakamega', Butere: 'Kakamega', Lugari: 'Kakamega', Matungu: 'Kakamega',
  Khwisero: 'Kakamega', Malava: 'Kakamega', Shinyalu: 'Kakamega', Ikolomani: 'Kakamega',
  // Vihiga
  Hamisi: 'Vihiga', Emuhaya: 'Vihiga', Sabatia: 'Vihiga', Luanda: 'Vihiga',
  // Siaya
  Bondo: 'Siaya', Ukwala: 'Siaya', Gem: 'Siaya', Rarieda: 'Siaya', Alego: 'Siaya', Yala: 'Siaya',
  // Kisumu
  Nyando: 'Kisumu', Maseno: 'Kisumu', Muhoroni: 'Kisumu', Nyakach: 'Kisumu',
  // Homa Bay
  Suba: 'Homa Bay', Ndhiwa: 'Homa Bay', Rachuonyo: 'Homa Bay', Mbita: 'Homa Bay', Rangwe: 'Homa Bay',
  // Migori
  Rongo: 'Migori', Kuria: 'Migori', Nyatike: 'Migori', Awendo: 'Migori', Uriri: 'Migori',
  // Kisii / Nyamira
  Gucha: 'Kisii', Nyamache: 'Kisii', Ogembo: 'Kisii', Marani: 'Kisii', Masaba: 'Kisii',
  Borabu: 'Nyamira', Nyamusi: 'Nyamira', Manga: 'Nyamira',
  // Narok
  Transmara: 'Narok', 'Trans Mara': 'Narok', Kilgoris: 'Narok',
  // Kajiado
  Ngong: 'Kajiado', Loitokitok: 'Kajiado', Kitengela: 'Kajiado', Magadi: 'Kajiado',
  // Machakos / Makueni / Kitui
  Kangundo: 'Machakos', Yatta: 'Machakos', Kathiani: 'Machakos', Masinga: 'Machakos',
  Mwala: 'Machakos', Athi: 'Machakos',
  Nzaui: 'Makueni', Kibwezi: 'Makueni', Wote: 'Makueni', Mbooni: 'Makueni', Kilungu: 'Makueni',
  Mwingi: 'Kitui', Mutomo: 'Kitui', Mutitu: 'Kitui', Kyuso: 'Kitui',
  // Meru / Tharaka Nithi / Embu
  Nyambene: 'Meru', Tigania: 'Meru', Igembe: 'Meru', Imenti: 'Meru', Maua: 'Meru', Timau: 'Meru',
  Chuka: 'Tharaka Nithi', Tharaka: 'Tharaka Nithi', Maara: 'Tharaka Nithi', Nithi: 'Tharaka Nithi',
  Runyenjes: 'Embu', Manyatta: 'Embu', Siakago: 'Embu', Mbeere: 'Embu',
  // Kirinyaga
  Kerugoya: 'Kirinyaga', Kutus: 'Kirinyaga', Mwea: 'Kirinyaga', Ndia: 'Kirinyaga', Gichugu: 'Kirinyaga',
  // Coast
  Malindi: 'Kilifi', Kaloleni: 'Kilifi', Ganze: 'Kilifi', Bahari: 'Kilifi', Magarini: 'Kilifi',
  Msambweni: 'Kwale', Kinango: 'Kwale', Matuga: 'Kwale', Lunga: 'Kwale',
  Voi: 'Taita Taveta', Wundanyi: 'Taita Taveta', Taveta: 'Taita Taveta', Mwatate: 'Taita Taveta',
  Hola: 'Tana River', Galole: 'Tana River', Bura: 'Tana River', Garsen: 'Tana River',
  Mpeketoni: 'Lamu', Faza: 'Lamu',
  // North Eastern / Northern
  Moyale: 'Marsabit', Sololo: 'Marsabit', Laisamis: 'Marsabit', Chalbi: 'Marsabit',
  Habaswein: 'Wajir', Griftu: 'Wajir', Bute: 'Wajir', Tarbaj: 'Wajir',
  Dadaab: 'Garissa', Fafi: 'Garissa', Ijara: 'Garissa', Balambala: 'Garissa', Hulugho: 'Garissa',
  Elwak: 'Mandera', 'El Wak': 'Mandera', Rhamu: 'Mandera', Takaba: 'Mandera', Banissa: 'Mandera',
  Garbatulla: 'Isiolo', Merti: 'Isiolo', Oldonyiro: 'Isiolo',
};

/** Longest-common-prefix-free lookup of the COUNTIES list, so a district
 *  that IS a county name resolves without needing its own map entry. */
const COUNTY_BY_LOWER = new Map<string, County>(COUNTIES.map((c) => [c.toLowerCase(), c]));
const DISTRICT_BY_LOWER = new Map<string, County>(
  Object.entries(DISTRICT_TO_COUNTY).map(([d, c]) => [d.toLowerCase(), c]),
);

/**
 * Best-effort county for a district or place name read off an ID.
 *
 * Tries the COUNTIES list first (most districts kept their name), then
 * the old-district table, then the same two again against just the first
 * word — "THIKA MUNICIPALITY", "KIAMBU WEST" and "NAIROBI WEST" are all
 * shapes that really appear on cards. Returns undefined rather than a
 * guess whenever none of that lands: an unset dropdown asks the person a
 * question, a wrongly set one tells them a lie.
 */
export function countyForDistrict(district: string | undefined | null): County | undefined {
  if (!district) return undefined;
  const clean = district.replace(/[^A-Za-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;

  const candidates = [clean];
  const firstWord = clean.split(' ')[0];
  // Two words catches "Trans Nzoia" / "Elgeyo Marakwet" / "Taita Taveta"
  // before the one-word fallback reduces them to a meaningless half.
  const firstTwo = clean.split(' ').slice(0, 2).join(' ');
  if (firstTwo !== clean) candidates.push(firstTwo);
  if (firstWord && firstWord !== clean) candidates.push(firstWord);

  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    const county = COUNTY_BY_LOWER.get(key) ?? DISTRICT_BY_LOWER.get(key);
    if (county) return county;
  }
  return undefined;
}

/** Which fields a parse actually produced — what the form uses to tell
 *  someone "this came off your ID" versus "we could not read this, please
 *  type it". A count of these is also the honest way to report how well
 *  the scan went, instead of claiming success whenever OCR merely ran. */
export function filledNationalIdFields(parsed: ParsedNationalId): Array<keyof ParsedNationalId> {
  return (Object.keys(parsed) as Array<keyof ParsedNationalId>).filter(
    (k) => parsed[k] !== undefined && String(parsed[k]).trim() !== '',
  );
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

  const placeOfIssue = valueAfterLabel(ls, /PLACE\s*OF\s*ISSUE/i);
  if (placeOfIssue) result.placeOfIssue = capitalise(placeOfIssue.replace(/[^A-Za-z\s'-]/g, '').trim());

  // County is not printed on a Kenyan ID at all — it's derived, which is
  // why it goes through countyForDistrict rather than a label lookup.
  // District of birth is the better signal of the two (place of issue is
  // wherever they happened to collect the card, often a city they were
  // only working in), so it's tried first and the fallback only runs when
  // it produced nothing.
  result.county = countyForDistrict(result.districtOfBirth)
    ?? countyForDistrict(result.placeOfIssue);

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
