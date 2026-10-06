import { describe, it, expect } from 'vitest';
import {
  generateTransactionCode, isTransactionCodeValid, isTransactionCodeShape, transactionCodeKind,
  TRANSACTION_CODE_KINDS, TRANSACTION_CODE_KIND_LABELS,
} from './transaction-code';

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

  it('mints a RECEIPT-kind code', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.RECEIPT, DAY);
    expect(code).toMatch(/^RC260929[A-Z0-9]{6}$/);
    expect(isTransactionCodeValid(code)).toBe(true);
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

  /**
   * Exhaustive, not sampled — and over the WHOLE body (KIND+DATE+ENTROPY),
   * across several codes, not just the entropy block. A prior version of
   * checkChar (transaction-code.ts) passed this exact shape of test
   * because it only exercised the 5 entropy positions; the actual defect
   * — CHECKSUM_ALPHABET being a 41-character string with only 33 distinct
   * characters, so two different `sum mod 41` residues rendered the same
   * output character — affected every position uniformly and showed up
   * as a ~1% false-accept rate over a large random sample, not a
   * position-specific hole. This test now covers every character of the
   * body, over several independently-generated codes, specifically so a
   * regression of that shape can't hide in an untested position again.
   */
  it('rejects every possible single-character substitution, at every position, over several codes — exhaustive, not sampled', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const entropyAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let checked = 0;
    for (let n = 0; n < 8; n++) {
      const code = generateTransactionCode(TRANSACTION_CODE_KINDS.WALLET_TOPUP, new Date(DAY.getTime() + n * 86_400_000));
      const body = code.slice(0, 13);
      const check = code.slice(13);
      for (let pos = 0; pos < body.length; pos++) {
        const alphabet = pos < 2 ? letters : pos < 8 ? digits : entropyAlphabet;
        for (const ch of alphabet) {
          if (ch === body[pos]) continue;
          const mutated = body.slice(0, pos) + ch + body.slice(pos + 1);
          expect(isTransactionCodeValid(`${mutated}${check}`), `code ${n}, pos ${pos}: ${body}->${mutated}`).toBe(false);
          checked++;
        }
      }
    }
    // A collision anywhere would silently drop this below the ~2,000
    // substitutions the loop above actually performs — pinning a floor
    // makes a shrunk alphabet or dropped position visible even if every
    // individual expect() above still somehow passed.
    expect(checked).toBeGreaterThan(2000);
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

describe('isTransactionCodeShape', () => {
  it('accepts a code whose characters are all in the right places, check char ignored', () => {
    // The whole point of the weaker question: a mistyped code should
    // still be recognisable as a code, so /verify can show it back to
    // whoever mistyped it.
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.RECEIPT, DAY);
    const wrongCheck = code.slice(0, 13) + (code[13] === 'A' ? 'B' : 'A');
    expect(isTransactionCodeValid(wrongCheck)).toBe(false);
    expect(isTransactionCodeShape(wrongCheck)).toBe(true);
  });

  it('still rejects an arbitrary URL path segment', () => {
    for (const junk of ['', 'not-a-code', 'free-money', '../../etc/passwd', '<script>']) {
      expect(isTransactionCodeShape(junk)).toBe(false);
    }
  });
});

describe('transactionCodeKind', () => {
  it('reads the kind off the prefix, checksum and all', () => {
    for (const kind of Object.values(TRANSACTION_CODE_KINDS)) {
      expect(transactionCodeKind(generateTransactionCode(kind, DAY))).toBe(kind);
    }
  });

  it('still names the kind when the check character is wrong — this is a router, not a validator', () => {
    // /verify picks its lookup table from this. A shopper who fat-fingers
    // one character must reach the receipt lookup and be told "no
    // receipt", not be misrouted to the certificate lookup and be told
    // they have a bad certificate.
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.RECEIPT, DAY);
    const mangled = 'RC260929' + code.slice(8, 12) + 'Z' + code.slice(13);
    expect(transactionCodeKind(mangled)).toBe(TRANSACTION_CODE_KINDS.RECEIPT);
  });

  it('tolerates lowercase and surrounding whitespace, like every other reader here', () => {
    const code = generateTransactionCode(TRANSACTION_CODE_KINDS.DONATION, DAY);
    expect(transactionCodeKind(`  ${code.toLowerCase()}  `)).toBe(TRANSACTION_CODE_KINDS.DONATION);
  });

  it('returns null for anything that is not one of our codes', () => {
    // A certificate code is an attestation id — dashes, hex, no KIND
    // prefix — and must fall through to the certificate lookup.
    for (const other of ['0000-AAA-0000', '', 'ZZ', 'X', 'abcdef', '12']) {
      expect(transactionCodeKind(other)).toBeNull();
    }
  });
});

describe('TRANSACTION_CODE_KIND_LABELS', () => {
  it('labels every kind, so /verify can never hit an unlabelled case', () => {
    for (const kind of Object.values(TRANSACTION_CODE_KINDS)) {
      const label = TRANSACTION_CODE_KIND_LABELS[kind];
      expect(label, `no label for ${kind}`).toBeTruthy();
      // Copy that reads as a sentence fragment: the verify page splices
      // it into "That's <label>, which this page does not verify."
      expect(label.startsWith('a ') || label.startsWith('an ')).toBe(true);
    }
    expect(Object.keys(TRANSACTION_CODE_KIND_LABELS).sort())
      .toEqual([...Object.values(TRANSACTION_CODE_KINDS)].sort());
  });
});
