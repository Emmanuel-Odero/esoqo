import { describe, it, expect } from 'vitest';
import { parseKenyanIdText } from './national-id-ocr';

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
});
