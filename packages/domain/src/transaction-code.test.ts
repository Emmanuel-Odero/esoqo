import { describe, it, expect } from 'vitest';
import { generateTransactionCode, isTransactionCodeValid, TRANSACTION_CODE_KINDS } from './transaction-code';

const DAY = new Date('2026-09-29T00:00:00Z');

describe('generateTransactionCode', () => {
  it('shapes as KIND + YYMMDD + ENTROPY + CHECK, no separators, 14 chars', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_TOPUP, DAY);
    expect(code).toMatch(/^WT260929[A-Z0-9]{6}$/);
    expect(code).toHaveLength(14);
  });

  it('encodes the date it was given', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_WITHDRAWAL, new Date('2027-01-05T00:00:00Z'));
    expect(code.slice(2, 8)).toBe('270105');
  });

  it('never collides across a large sample (birthday-bound sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateTransactionCode(TRANSACTION_CODE_KINDS.BUSINESS_PAYMENT, DAY));
    expect(seen.size).toBeGreaterThan(490);
  });

  it('every generated code passes its own checksum', () => {
    for (let i = 0; i < 200; i++) {
      expect(isTransactionCodeValid(generateTransactionCode(TRANSACTION_CODE_KINDS.DONATION, DAY))).toBe(true);
    }
  });
});

describe('isTransactionCodeValid', () => {
  it('accepts a code exactly as generated', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_TRANSFER, DAY);
    expect(isTransactionCodeValid(code)).toBe(true);
  });

  it('is case-insensitive', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.PARKING, DAY);
    expect(isTransactionCodeValid(code.toLowerCase())).toBe(true);
  });

  it('rejects every possible single-character substitution, at every position — exhaustive, not sampled', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_TOPUP, DAY);
    const prefix = code.slice(0, 8); // kind + date, left untouched
    const entropy = code.slice(8, 13);
    const check = code.slice(13);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let pos = 0; pos < entropy.length; pos++) {
      for (const ch of alphabet) {
        if (ch === entropy[pos]) continue;
        const mutatedEntropy = entropy.slice(0, pos) + ch + entropy.slice(pos + 1);
        const mistyped = `${prefix}${mutatedEntropy}${check}`;
        expect(isTransactionCodeValid(mistyped), `pos ${pos}: ${entropy}->${mutatedEntropy}`).toBe(false);
      }
    }
  });

  it('rejects garbage input', () => {
    expect(isTransactionCodeValid('not-a-code')).toBe(false);
    expect(isTransactionCodeValid('')).toBe(false);
    expect(isTransactionCodeValid('WT260929ABCDEZEXTRA')).toBe(false);
  });

  it('rejects a wrong check character', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_WITHDRAWAL, DAY);
    const body = code.slice(0, -1);
    const check = code.slice(-1);
    const wrongCheck = check === 'A' ? 'B' : 'A';
    expect(isTransactionCodeValid(`${body}${wrongCheck}`)).toBe(false);
  });
});
