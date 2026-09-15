import { describe, expect, it } from 'vitest';

import {
  ZERO_CENTS,
  addCents,
  displayKES,
  formatKES,
  mulCents,
  percentOfCents,
  subCents,
  sumCents,
  toCents,
  toCentsOrZero,
  toKES,
  toWire,
} from './money';

describe('toCents — both wire shapes', () => {
  it('parses the Prisma / converged core-go string form', () => {
    expect(toCents('254.15')).toBe(25415);
    expect(toCents('1200.00')).toBe(120000);
    expect(toCents('0.05')).toBe(5);
    expect(toCents('7.5')).toBe(750);
  });

  it('parses the unconverged core-go number form', () => {
    expect(toCents(254.15)).toBe(25415);
    expect(toCents(1200)).toBe(120000);
  });

  it('agrees across both shapes', () => {
    expect(toCents('254.15')).toBe(toCents(254.15));
  });

  it('recovers a float that already drifted', () => {
    expect(toCents(254.14999999999998)).toBe(25415);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('tolerates what real payloads and inputs contain', () => {
    expect(toCents(' 1,250.50 ')).toBe(125050);
    expect(toCents('-45.20')).toBe(-4520);
    expect(toCents('+7')).toBe(700);
    expect(toCents('.5')).toBe(50);
    expect(toCents('7.')).toBe(700);
  });

  it('rounds beyond two decimals to the nearest cent', () => {
    expect(toCents('10.005')).toBe(1001);
    expect(toCents('10.004')).toBe(1000);
    expect(toCents('10.999')).toBe(1100);
  });

  it('keeps missing distinct from zero', () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents('')).toBeNull();
    expect(toCents('   ')).toBeNull();
    expect(toCents('abc')).toBeNull();
    expect(toCents('1.2.3')).toBeNull();
    expect(toCents(NaN)).toBeNull();
    expect(toCents(Infinity)).toBeNull();
    expect(toCents('0')).toBe(0);
  });

  it('toCentsOrZero collapses missing to zero, deliberately', () => {
    expect(toCentsOrZero(null)).toBe(0);
    expect(toCentsOrZero('12.34')).toBe(1234);
  });

  // Number() is what a developer reaches for instead of this module.
  it('beats Number() on the inputs that matter', () => {
    expect(Number('1,250.00')).toBeNaN();
    expect(toCents('1,250.00')).toBe(125000);
  });
});

describe('arithmetic — the operations that break on raw string fields', () => {
  it('sums exactly where + would concatenate', () => {
    const rows = ['250.00', '1300.00', '0.50'];

    // What the codebase did before: string concatenation, silently.
    const viaPlus = rows.reduce<any>((sum, r) => sum + r, 0);
    expect(viaPlus).toBe('0250.001300.000.50');

    const total = sumCents(rows.map((r) => toCentsOrZero(r)));
    expect(total).toBe(155050);
    expect(formatKES(total)).toBe('1,550.50');
  });

  it('accumulates without float drift', () => {
    let viaFloat = 0;
    for (let i = 0; i < 10; i++) viaFloat += 0.1;
    expect(viaFloat).not.toBe(1);

    const tenths = Array.from({ length: 10 }, () => toCentsOrZero('0.10'));
    expect(sumCents(tenths)).toBe(100);
  });

  it('adds, subtracts and multiplies exactly', () => {
    expect(addCents(toCentsOrZero('10.01'), toCentsOrZero('0.99'))).toBe(1100);
    expect(subCents(toCentsOrZero('10.00'), toCentsOrZero('0.01'))).toBe(999);
    expect(mulCents(toCentsOrZero('33.33'), 3)).toBe(9999);
  });

  it('splits a percentage so the remainder always reconciles', () => {
    const prices = [0, 1, 99, 100, 12345, 99999, 100000];
    const pcts = [0, 0.5, 1, 7.5, 12.345, 15, 33.33, 50, 99.9, 100];
    for (const price of prices) {
      for (const pct of pcts) {
        const fee = percentOfCents(price as never, pct);
        const rest = subCents(price as never, fee);
        expect(addCents(fee, rest)).toBe(price);
      }
    }
  });

  it('sums an empty list to zero', () => {
    expect(sumCents([])).toBe(ZERO_CENTS);
  });
});

describe('formatKES', () => {
  it('hides cents when zero, shows them when not', () => {
    expect(formatKES(toCentsOrZero('250'))).toBe('250');
    expect(formatKES(toCentsOrZero('250.50'))).toBe('250.50');
    expect(formatKES(toCentsOrZero('250.05'))).toBe('250.05');
  });

  it('alwaysCents forces two places', () => {
    expect(formatKES(toCentsOrZero('250'), { alwaysCents: true })).toBe('250.00');
  });

  it('groups thousands', () => {
    expect(formatKES(toCentsOrZero('1000'))).toBe('1,000');
    expect(formatKES(toCentsOrZero('1234567.89'))).toBe('1,234,567.89');
    expect(formatKES(toCentsOrZero('100'))).toBe('100');
  });

  it('keeps the sign outside the grouping', () => {
    expect(formatKES(toCentsOrZero('-1234.56'))).toBe('-1,234.56');
  });
});

describe('displayKES', () => {
  it('renders either wire shape', () => {
    expect(displayKES('1250.00')).toBe('1,250');
    expect(displayKES(1250)).toBe('1,250');
  });

  it('shows a dash for a missing amount rather than KES 0', () => {
    expect(displayKES(null)).toBe('—');
    expect(displayKES(undefined, { fallback: 'not set' })).toBe('not set');
  });
});

describe('wire round trip', () => {
  it('round-trips exactly', () => {
    for (const raw of ['0.00', '1.05', '999.99', '-45.20', '1250.00']) {
      expect(toWire(toCentsOrZero(raw))).toBe(raw);
    }
    expect(toWire(toCentsOrZero('1,250.50'))).toBe('1250.50');
  });

  it('toKES bridges to endpoints still typed float64', () => {
    expect(toKES(toCentsOrZero('2500.50'))).toBe(2500.5);
  });
});
