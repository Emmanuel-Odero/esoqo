/// Money as an exact integer count of cents — never a `double`.
///
/// ## Why this exists
///
/// Postgres stores every KES amount correctly: `Decimal(12, 2)` on the
/// money columns, `Decimal(18, 2)` on the ledger (see
/// packages/db/prisma/schema.prisma). Precision is sound at rest. It was
/// being destroyed in transit and in arithmetic, on both sides:
///
///   * core-go declares its money fields `float64` (see
///     internal/httpapi/handlers_parcel_cod.go, internal/ledger/ledger.go)
///     and *computes* with them — `ParcelCoverageTier.CoverageFeeKes`
///     takes and returns a float64 whose result is written straight back
///     into a Decimal column.
///   * mobile parsed everything into `double` and did the same.
///
/// The cost was not theoretical. `ParcelPricing.priceForReason` computed
/// `minKes * (1 - pct / 100)`, which for ordinary inputs lands on values
/// like 254.14999999999998. And `CompleteDeliveryScreen`'s cash-on-delivery
/// reconciliation carried this line:
///
/// ```dart
/// if (short <= 0.004) return const SizedBox.shrink();
/// ```
///
/// That epsilon is a float-drift workaround written by someone who hit the
/// bug on a doorstep: a courier shown "KES 0.0000001 short" while holding
/// somebody else's cash. [Money] removes the cause, so that line can go.
///
/// ## Two wire formats
///
/// This type parses both shapes the API actually emits today, because the
/// backend is inconsistent and mobile cannot wait for it to converge:
///
///   * **JSON string** — `"254.15"`. Prisma serialises `Decimal` this way
///     through the TS endpoints. Precision is preserved on the wire.
///   * **JSON number** — `254.15`. core-go's `float64` fields. Precision
///     is already lost before it reaches us; we capture the closest exact
///     cent and stop the bleeding here.
///
/// [Money.fromJson] handles either without the call site knowing which
/// endpoint it came from. See docs/proposals/mobile-component-system.md
/// §2 for why "the call site should not need to know" is the governing
/// rule for this codebase.
library;

import 'package:flutter/foundation.dart';

@immutable
class Money implements Comparable<Money> {
  /// The canonical constructor: an exact number of cents.
  const Money.fromCents(this.cents);

  /// Zero — the identity for [+] and the safe default for a missing
  /// amount. Prefer this over `Money.fromCents(0)` at call sites.
  static const zero = Money.fromCents(0);

  /// Whole shillings, no cents. `Money.shillings(250)` == `KES 250.00`.
  const Money.shillings(int shillings) : cents = shillings * 100;

  /// The exact number of cents. This is the only stored state; every
  /// other member derives from it, so two [Money] values that represent
  /// the same amount are always `==` and always hash alike.
  final int cents;

  // ---------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------

  /// Parses either wire format, or anything else, without throwing.
  ///
  /// Returns null for null, empty, and unparseable input rather than
  /// defaulting to zero: a missing amount and an amount of zero are
  /// different facts, and collapsing them is how "KES 0" ends up on a
  /// screen that should have said "not set". Call sites that genuinely
  /// want zero can write `Money.fromJson(x) ?? Money.zero` and say so.
  static Money? fromJson(Object? value) {
    if (value == null) return null;
    if (value is Money) return value;
    // core-go's float64 fields arrive as num. Precision is already gone
    // by the time it is on the wire; round to nearest cent so at least
    // 254.14999999999998 becomes an exact 25415 rather than truncating
    // to 25414 and silently shorting somebody a cent.
    if (value is int) return Money.fromCents(value * 100);
    if (value is double) {
      if (!value.isFinite) return null;
      return Money.fromCents((value * 100).round());
    }
    if (value is String) return tryParse(value);
    return null;
  }

  /// Parses a decimal string — the Prisma/`Decimal` wire shape, and also
  /// what a user types into an amount field.
  ///
  /// Deliberately string-based rather than `double.parse` then scale:
  /// going through a double is exactly the precision loss this class
  /// exists to prevent. Accepts an optional sign, thousands separators,
  /// surrounding whitespace and a `KES` prefix, because all of those
  /// reach it from real input. More than two decimal places round to the
  /// nearest cent (half away from zero) rather than truncating.
  static Money? tryParse(String? raw) {
    if (raw == null) return null;
    var s = raw.trim();
    if (s.isEmpty) return null;

    // Tolerate what users and labels actually contain.
    s = s.replaceAll(_currencyPrefix, '').replaceAll(',', '').trim();
    if (s.isEmpty) return null;

    var negative = false;
    if (s.startsWith('-')) {
      negative = true;
      s = s.substring(1);
    } else if (s.startsWith('+')) {
      s = s.substring(1);
    }
    if (s.isEmpty) return null;

    final parts = s.split('.');
    if (parts.length > 2) return null;

    final whole = parts[0].isEmpty ? '0' : parts[0];
    if (!_digits.hasMatch(whole)) return null;
    final wholeValue = int.tryParse(whole);
    if (wholeValue == null) return null;

    var centsValue = 0;
    if (parts.length == 2 && parts[1].isNotEmpty) {
      final frac = parts[1];
      if (!_digits.hasMatch(frac)) return null;
      // Pad "5" -> "50"; round anything beyond 2dp to the nearest cent.
      if (frac.length == 1) {
        centsValue = int.parse(frac) * 10;
      } else {
        centsValue = int.parse(frac.substring(0, 2));
        if (frac.length > 2 && int.parse(frac[2]) >= 5) centsValue += 1;
      }
    }

    final total = wholeValue * 100 + centsValue;
    return Money.fromCents(negative ? -total : total);
  }

  static final _digits = RegExp(r'^\d+$');

  /// Dart's RegExp has no inline `(?i)` flag — case-insensitivity is a
  /// constructor argument. Compiled once here rather than per parse.
  static final _currencyPrefix = RegExp(r'\bkes\b', caseSensitive: false);

  // ---------------------------------------------------------------
  // Arithmetic — exact, because it is all integer
  // ---------------------------------------------------------------

  Money operator +(Money other) => Money.fromCents(cents + other.cents);
  Money operator -(Money other) => Money.fromCents(cents - other.cents);
  Money operator -() => Money.fromCents(-cents);

  /// Multiply by a whole count — a cart line, a batch of vouchers, a
  /// quantity of tickets. Exact by construction.
  Money operator *(int quantity) => Money.fromCents(cents * quantity);

  /// Apply a percentage, rounding to the nearest cent.
  ///
  /// This replaces `minKes * (1 - pct / 100)` in
  /// `ParcelPricing.priceForReason`. [percent] is the percentage itself
  /// (15 for 15%), not a fraction, matching how the server's discount
  /// fields are expressed.
  Money percentage(num percent) =>
      Money.fromCents((cents * percent / 100).round());

  /// This amount less [percent] — the discount case, stated directly so
  /// the call site does not have to spell out `x - x.percentage(p)` and
  /// risk rounding each half independently.
  Money discounted(num percent) => this - percentage(percent);

  /// Sum without an initial-value footgun. `Money.sum(lines.map(...))`
  /// replaces `fold(0.0, (a, b) => a + b)` on doubles, which is where
  /// cart totals drifted (table_order_screen.dart:71,
  /// self_checkout_screen.dart:54).
  static Money sum(Iterable<Money> amounts) =>
      amounts.fold(zero, (total, amount) => total + amount);

  // ---------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------

  bool get isZero => cents == 0;
  bool get isPositive => cents > 0;
  bool get isNegative => cents < 0;

  Money get absolute => Money.fromCents(cents.abs());

  bool operator >(Money other) => cents > other.cents;
  bool operator >=(Money other) => cents >= other.cents;
  bool operator <(Money other) => cents < other.cents;
  bool operator <=(Money other) => cents <= other.cents;

  @override
  int compareTo(Money other) => cents.compareTo(other.cents);

  @override
  bool operator ==(Object other) => other is Money && other.cents == cents;

  @override
  int get hashCode => cents.hashCode;

  // ---------------------------------------------------------------
  // Display
  // ---------------------------------------------------------------

  /// Digits only, grouped, no currency prefix — feed this to
  /// [EsokoAmountText], which owns the `KES ` prefix and the mono
  /// treatment.
  ///
  /// Cents are shown only when they are non-zero. Kenyan prices are
  /// overwhelmingly whole shillings, and rendering "KES 250.00" where
  /// every other line says "KES 250" is the kind of inconsistency that
  /// made the audit's font-size table look the way it does. When cents
  /// do exist they are always shown — never silently rounded away on a
  /// screen a user checks against cash in hand.
  String format({bool forceCents = false}) {
    final negative = cents < 0;
    final abs = cents.abs();
    final whole = abs ~/ 100;
    final frac = abs % 100;
    final grouped = _group(whole);
    final body = (frac == 0 && !forceCents)
        ? grouped
        : '$grouped.${frac.toString().padLeft(2, '0')}';
    return negative ? '-$body' : body;
  }

  /// The exact decimal string to send back over the wire — always two
  /// decimal places, never grouped, so it round-trips through Prisma's
  /// `Decimal` and through core-go's parser unchanged.
  String toWire() {
    final negative = cents < 0;
    final abs = cents.abs();
    final body = '${abs ~/ 100}.${(abs % 100).toString().padLeft(2, '0')}';
    return negative ? '-$body' : body;
  }

  static String _group(int whole) {
    final digits = whole.toString();
    if (digits.length <= 3) return digits;
    final buffer = StringBuffer();
    final lead = digits.length % 3;
    if (lead > 0) buffer.write(digits.substring(0, lead));
    for (var i = lead; i < digits.length; i += 3) {
      if (buffer.isNotEmpty) buffer.write(',');
      buffer.write(digits.substring(i, i + 3));
    }
    return buffer.toString();
  }

  @override
  String toString() => 'Money(KES ${toWire()})';
}
