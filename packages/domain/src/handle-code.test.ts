import { describe, it, expect } from 'vitest';
import { generateSystemHandle, isSystemHandleShape, HANDLE_DIGIT_LENGTH } from './handle-code';
import { isEsoqoIdShape, extractEsoqoId } from './pay-code';

describe('generateSystemHandle', () => {
  it('always ends with HANDLE_DIGIT_LENGTH digits', () => {
    const handle = generateSystemHandle(['John', 'Mutuku', 'Kamau']);
    const digits = handle.slice(-HANDLE_DIGIT_LENGTH);
    expect(digits).toMatch(/^[0-9]+$/);
    expect(digits).toHaveLength(HANDLE_DIGIT_LENGTH);
  });

  it('is lowercase and contains only letters and digits', () => {
    const handle = generateSystemHandle(['John', 'Mutuku', 'Kamau']);
    expect(handle).toMatch(/^[a-z0-9]+$/);
  });

  it('works with a single name', () => {
    const handle = generateSystemHandle(['Solo']);
    expect(handle).toMatch(/^[a-z]+[0-9]{3}$/);
  });

  it('throws when given no usable names', () => {
    expect(() => generateSystemHandle([])).toThrow();
    expect(() => generateSystemHandle(['', '   '])).toThrow();
  });

  it('never collides across a large sample (birthday-bound sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateSystemHandle(['John', 'Mutuku', 'Kamau']));
    // Not a uniqueness guarantee (that's the DB's job) — just confirms
    // the generator isn't degenerately narrow.
    expect(seen.size).toBeGreaterThan(400);
  });
});

describe('isSystemHandleShape', () => {
  it('accepts a generated handle', () => {
    expect(isSystemHandleShape(generateSystemHandle(['John', 'Mutuku', 'Kamau']))).toBe(true);
  });

  it('rejects an ESK- payment code', () => {
    expect(isSystemHandleShape('ESK-BCUP2K-KE')).toBe(false);
  });

  it('is case-insensitive but rejects punctuation', () => {
    expect(isSystemHandleShape('Mutuku482')).toBe(true);
    expect(isSystemHandleShape('mutuku-482')).toBe(false);
  });
});

describe('isEsoqoIdShape / extractEsoqoId with the new handle shape', () => {
  it('accepts both an ESK- code and a handle', () => {
    expect(isEsoqoIdShape('ESK-BCUP2K-KE')).toBe(true);
    expect(isEsoqoIdShape('mutukuka482')).toBe(true);
  });

  it('round-trips a bare handle through extractEsoqoId', () => {
    expect(extractEsoqoId('mutukuka482')).toBe('mutukuka482');
    expect(extractEsoqoId(' MUTUKUKA482 ')).toBe('mutukuka482');
  });

  it('round-trips a handle out of a pay link', () => {
    expect(extractEsoqoId('https://esoqo.com/pay?to=mutukuka482')).toBe('mutukuka482');
    expect(extractEsoqoId('https://esoqo.com/pay/mutukuka482')).toBe('mutukuka482');
  });
});
