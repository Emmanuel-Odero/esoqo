/**
 * Money formatting for every dashboard surface.
 *
 * Amounts are carried as exact integer cents on the wire (see
 * core-go's money.Amount and the money-representation proposal), so a
 * display helper must never round a figure away. The portal used to
 * format with `maximumFractionDigits: 0` and the admin dashboards with
 * `Math.round`, which turned KES 1,234.50 into "KES 1,235" and made two
 * totals that differ by cents read as identical. Everything here keeps
 * the twenty shillings and never invents a whole one.
 *
 * `minimumFractionDigits` and `maximumFractionDigits` are pinned to 2
 * so a whole number still reads as "KES 1,000.00" — a column of money
 * that is sometimes "1,000" and sometimes "1,000.50" is harder to scan
 * than one that always carries its cents.
 */
export interface FormatKesOptions {
  /** Include the "KES " prefix. Default true. */
  prefix?: boolean;
  /** Always show an explicit +/- sign. Default false (only "-" for negatives). */
  signed?: boolean;
}

/** Format a KES amount with exact cents. `1234.5` → "KES 1,234.50". */
export function formatKes(
  value: number | string | null | undefined,
  opts: FormatKesOptions = {},
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || !Number.isFinite(n)) return '—';
  const body = Math.abs(n).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? '-' : opts.signed ? '+' : '';
  return `${sign}${opts.prefix === false ? '' : 'KES '}${body}`;
}
