/**
 * Money as an exact integer count of cents.
 *
 * The third mirror of the same rules: `services/core-go/internal/money`
 * (Go) and `mobile/esoqo_app/lib/core/money/money.dart` (Dart) are the
 * other two. A rounding rule has to mean the same thing on all three
 * sides of the wire, so all three round half away from zero and all
 * three treat a missing amount as distinct from zero.
 *
 * ## Why this exists on the TypeScript side
 *
 * Postgres stores money correctly — `Decimal(12,2)`, and `Decimal(18,2)`
 * on the ledger. Prisma serialises those as **strings**, so anything
 * TS-served already arrives as `"254.15"`. core-go historically sent
 * JSON **numbers**, and is converging on the string form (see
 * `docs/proposals/money-representation.md`).
 *
 * That convergence is the reason this module is not optional. A field
 * that used to arrive as `1250` and now arrives as `"1250.00"` breaks
 * TypeScript in a particularly nasty way:
 *
 * ```ts
 * items.reduce((sum, i) => sum + i.amountKes, 0)  // "0250.001300.00…"
 * Math.round(courier.owedKes)                      // NaN
 * fee > 0                                          // string comparison
 * ```
 *
 * The first one is the dangerous one: `+` silently concatenates rather
 * than throwing, so a total becomes nonsense without any error.
 *
 * ## How to use it
 *
 * Parse once at the boundary, do arithmetic in cents, format at the end:
 *
 * ```ts
 * const total = sumCents(rows.map((r) => toCents(r.amountKes)));
 * return formatKES(total);            // "12,345.67"
 * ```
 *
 * Never `Number(x)` a money field. It works for `"1250.00"` and lies for
 * `"1,250.00"`.
 */

/** An exact amount, in cents. Branded so a raw number cannot stand in. */
export type Cents = number & { readonly __brand: 'Cents' };

const asCents = (n: number): Cents => n as Cents;

export const ZERO_CENTS: Cents = asCents(0);

/**
 * Parses either wire shape into exact cents: a decimal string
 * (`"254.15"`, Prisma and converged core-go) or a number (`254.15`,
 * unconverged core-go).
 *
 * Returns `null` for null/undefined/empty/unparseable rather than
 * defaulting to zero — a missing amount and an amount of zero are
 * different facts, and collapsing them is how "KES 0" ends up on a
 * screen that should have said "not set". Callers that genuinely want
 * zero write `toCents(x) ?? ZERO_CENTS` and say so.
 */
export function toCents(value: string | number | null | undefined): Cents | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return asCents(Math.round(value * 100));
  }

  let s = value.trim().replace(/,/g, '');
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s === '') return null;

  const parts = s.split('.');
  if (parts.length > 2) return null;

  const whole = parts[0] || '0';
  if (!/^\d+$/.test(whole)) return null;

  let cents = Number(whole) * 100;

  const frac = parts[1];
  if (frac !== undefined && frac !== '') {
    if (!/^\d+$/.test(frac)) return null;
    if (frac.length === 1) {
      cents += Number(frac) * 10;
    } else {
      cents += Number(frac.slice(0, 2));
      // Round anything beyond 2dp to the nearest cent.
      if (Number(frac.slice(2, 3)) >= 5) cents += 1;
    }
  }

  return asCents(negative ? -cents : cents);
}

/**
 * `toCents` with zero as the fallback. Use where "absent" and "zero"
 * genuinely mean the same thing to the reader — a running total, a sum
 * over rows — and `toCents` everywhere else.
 */
export function toCentsOrZero(value: string | number | null | undefined): Cents {
  return toCents(value) ?? ZERO_CENTS;
}

/** Exact addition. Replaces `reduce((a, b) => a + b, 0)` over raw fields. */
export function sumCents(values: readonly Cents[]): Cents {
  return asCents(values.reduce<number>((total, c) => total + c, 0));
}

export function addCents(a: Cents, b: Cents): Cents {
  return asCents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return asCents(a - b);
}

/** Multiply by a whole count — a cart line, a quantity of tickets. */
export function mulCents(amount: Cents, quantity: number): Cents {
  return asCents(Math.round(amount * quantity));
}

/**
 * `percent` percent of `amount`, rounded to the nearest cent (half away
 * from zero). `percent` is the percentage itself — 15 for 15%.
 */
export function percentOfCents(amount: Cents, percent: number): Cents {
  if (!Number.isFinite(percent)) return ZERO_CENTS;
  return asCents(Math.round((amount * percent) / 100));
}

/**
 * Formats for display: grouped, with cents shown only when they are
 * non-zero.
 *
 * Kenyan prices are overwhelmingly whole shillings, and rendering
 * "KES 250.00" where every other line says "KES 250" is exactly the
 * inconsistency this project is trying to remove. When cents do exist
 * they are always shown — never silently rounded away on a number
 * somebody checks against cash in hand.
 *
 * Returns digits only; the caller supplies "KES", matching how the
 * existing markup is written.
 */
export function formatKES(
  amount: Cents,
  options: { alwaysCents?: boolean } = {},
): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;

  const grouped = whole.toLocaleString('en-KE');
  const body =
    frac === 0 && !options.alwaysCents
      ? grouped
      : `${grouped}.${String(frac).padStart(2, '0')}`;

  return negative ? `-${body}` : body;
}

/** Convenience: parse and format in one step, for read-only display. */
export function displayKES(
  value: string | number | null | undefined,
  options: { alwaysCents?: boolean; fallback?: string } = {},
): string {
  const cents = toCents(value);
  if (cents === null) return options.fallback ?? '—';
  return formatKES(cents, options);
}

/**
 * The exact decimal string to send back over the wire — always two
 * places, never grouped, so it round-trips through Prisma's `Decimal`
 * and core-go's `money.Amount` unchanged.
 */
export function toWire(amount: Cents): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const body = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** For the float64-typed request fields that have not converged yet. */
export function toKES(amount: Cents): number {
  return amount / 100;
}
