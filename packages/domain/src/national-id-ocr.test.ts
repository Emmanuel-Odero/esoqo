import { describe, it, expect } from 'vitest';
import {
  parseKenyanIdText, countyForDistrict, filledNationalIdFields, splitFullNames,
} from './national-id-ocr';

const SAMPLE_FRONT = `
REPUBLIC OF KENYA
HAPA NI KWETU
FULL NAMES
JOHN MUTUKU KAMAU
DATE OF BIRTH
01.01.1990
SEX
M
DISTRICT OF BIRTH
NAIROBI
ID NUMBER
12345678
`;

const SAMPLE_BACK = `
DATE OF ISSUE
15.03.2015
SERIAL NUMBER
987654321
HOLDER'S SIGN
`;

describe('parseKenyanIdText', () => {
  it('extracts and splits the full names', () => {
    const r = parseKenyanIdText(SAMPLE_FRONT);
    expect(r.firstName).toBe('John');
    expect(r.middleName).toBe('Mutuku');
    expect(r.surname).toBe('Kamau');
  });

  it('extracts date of birth as ISO', () => {
    expect(parseKenyanIdText(SAMPLE_FRONT).dateOfBirth).toBe('1990-01-01');
  });

  it('extracts sex', () => {
    expect(parseKenyanIdText(SAMPLE_FRONT).sex).toBe('MALE');
  });

  it('extracts district of birth', () => {
    expect(parseKenyanIdText(SAMPLE_FRONT).districtOfBirth).toBe('Nairobi');
  });

  it('extracts the ID number', () => {
    expect(parseKenyanIdText(SAMPLE_FRONT).idNumber).toBe('12345678');
  });

  it('extracts date of issue and serial number from the back', () => {
    const r = parseKenyanIdText(SAMPLE_BACK);
    expect(r.dateOfIssue).toBe('2015-03-15');
    expect(r.serialNumber).toBe('987654321');
  });

  it('handles a single name gracefully', () => {
    const r = parseKenyanIdText('FULL NAMES\nMUTUKU');
    expect(r.firstName).toBe('Mutuku');
    expect(r.middleName).toBeUndefined();
    expect(r.surname).toBeUndefined();
  });

  it('returns an empty object for unrecognisable garbage', () => {
    const r = parseKenyanIdText('asdlkj 123 !!! blah');
    expect(r.firstName).toBeUndefined();
    expect(r.dateOfBirth).toBeUndefined();
  });

  it('does not crash on empty input', () => {
    expect(parseKenyanIdText('')).toEqual({});
  });

  it('reads place of issue, which no field on the form stores directly', () => {
    const r = parseKenyanIdText('PLACE OF ISSUE\nTHIKA\nDATE OF ISSUE\n15.03.2015');
    expect(r.placeOfIssue).toBe('Thika');
  });
});

describe('county derivation', () => {
  it('prefills the county for a district that kept its name', () => {
    expect(parseKenyanIdText(SAMPLE_FRONT).county).toBe('Nairobi');
  });

  it('maps an old district onto the county that absorbed it', () => {
    expect(countyForDistrict('THIKA')).toBe('Kiambu');
    expect(countyForDistrict('KITALE')).toBe('Trans Nzoia');
    expect(countyForDistrict('KAPENGURIA')).toBe('West Pokot');
  });

  it('matches a two-word county before falling back to one word', () => {
    // "Trans" alone means nothing; "Elgeyo" alone would miss Marakwet.
    expect(countyForDistrict('TRANS NZOIA')).toBe('Trans Nzoia');
    expect(countyForDistrict('ELGEYO MARAKWET')).toBe('Elgeyo Marakwet');
    expect(countyForDistrict('TAITA TAVETA')).toBe('Taita Taveta');
  });

  it('tolerates the qualifiers real cards print after the district', () => {
    expect(countyForDistrict('THIKA MUNICIPALITY')).toBe('Kiambu');
    expect(countyForDistrict('NAIROBI WEST')).toBe('Nairobi');
  });

  it('survives the punctuation OCR sprinkles into a district line', () => {
    expect(countyForDistrict('K1AMBU')).toBeUndefined(); // a misread is not a guess
    expect(countyForDistrict('KIAMBU.')).toBe('Kiambu');
  });

  it('falls back to place of issue only when district of birth gave nothing', () => {
    const both = parseKenyanIdText(
      'DISTRICT OF BIRTH\nTHIKA\nPLACE OF ISSUE\nMOMBASA',
    );
    expect(both.county).toBe('Kiambu');

    const issueOnly = parseKenyanIdText('PLACE OF ISSUE\nMOMBASA');
    expect(issueOnly.county).toBe('Mombasa');
  });

  it('leaves the county unset rather than guessing', () => {
    expect(countyForDistrict('SOMEWHERE ELSE')).toBeUndefined();
    expect(countyForDistrict('')).toBeUndefined();
    expect(countyForDistrict(null)).toBeUndefined();
    expect(parseKenyanIdText(SAMPLE_BACK).county).toBeUndefined();
  });
});

describe('filledNationalIdFields', () => {
  it('lists only what the scan actually produced', () => {
    const filled = filledNationalIdFields(parseKenyanIdText(SAMPLE_FRONT));
    expect(filled).toContain('firstName');
    expect(filled).toContain('county');
    expect(filled).not.toContain('serialNumber');
    expect(filled).not.toContain('dateOfIssue');
  });

  it('is empty when nothing was read, so the form can say so honestly', () => {
    expect(filledNationalIdFields(parseKenyanIdText('nothing useful here'))).toEqual([]);
  });
});

describe('splitFullNames', () => {
  it('splits a stored single name string back into the three form fields', () => {
    expect(splitFullNames('Jane Wanjiru Kamau')).toEqual({
      firstName: 'Jane', middleName: 'Wanjiru', surname: 'Kamau',
    });
  });

  it('puts everything between first and last into the middle name', () => {
    expect(splitFullNames('JANE A B KAMAU').middleName).toBe('A B');
  });

  it('leaves surname unset for a one-word name rather than duplicating it', () => {
    expect(splitFullNames('Jane')).toEqual({ firstName: 'Jane' });
  });
});
