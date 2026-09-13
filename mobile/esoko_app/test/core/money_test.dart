// Tests for Money — the integer-cents replacement for `double` money.
//
// Every group below that names a file and line is pinned to a real defect
// found in the audit, not a hypothetical. Where a test asserts that the
// double version was wrong, it computes the double result inline and
// asserts the drift, so the test fails loudly if someone "simplifies"
// Money back to a double.
import 'package:flutter_test/flutter_test.dart';

import 'package:esoko_app/core/money/money.dart';

void main() {
  group('parsing the two wire formats', () {
    test('Prisma Decimal arrives as a JSON string', () {
      expect(Money.fromJson('254.15')!.cents, 25415);
      expect(Money.fromJson('0.05')!.cents, 5);
      expect(Money.fromJson('1200')!.cents, 120000);
    });

    test('core-go float64 arrives as a JSON number', () {
      expect(Money.fromJson(254.15)!.cents, 25415);
      expect(Money.fromJson(1200)!.cents, 120000);
    });

    test('a float64 that already drifted is captured at the nearest cent', () {
      // This is what core-go puts on the wire after computing
      // CoverageFeeKes in float64. Truncating would short the payee a
      // cent; rounding recovers the amount that was meant.
      expect(Money.fromJson(254.14999999999998)!.cents, 25415);
      expect(Money.fromJson(0.1 + 0.2)!.cents, 30);
    });

    test('missing is distinct from zero', () {
      expect(Money.fromJson(null), isNull);
      expect(Money.fromJson(''), isNull);
      expect(Money.fromJson('   '), isNull);
      expect(Money.fromJson('abc'), isNull);
      expect(Money.fromJson(double.nan), isNull);
      expect(Money.fromJson(double.infinity), isNull);
      // ...but zero itself parses to a real zero.
      expect(Money.fromJson('0')!.isZero, isTrue);
    });

    test('tolerates what real input actually contains', () {
      expect(Money.tryParse(' 1,250.50 ')!.cents, 125050);
      expect(Money.tryParse('KES 300')!.cents, 30000);
      expect(Money.tryParse('-45.20')!.cents, -4520);
      expect(Money.tryParse('.5')!.cents, 50);
      expect(Money.tryParse('7.')!.cents, 700);
    });

    test('rejects malformed input rather than guessing', () {
      expect(Money.tryParse('1.2.3'), isNull);
      expect(Money.tryParse('12a.00'), isNull);
      expect(Money.tryParse('-'), isNull);
    });

    test('rounds beyond two decimals to the nearest cent', () {
      expect(Money.tryParse('10.005')!.cents, 1001);
      expect(Money.tryParse('10.004')!.cents, 1000);
      expect(Money.tryParse('10.999')!.cents, 1100);
    });
  });

  // parcel_models.dart:107 — priceForReason computed
  //   minKes * (1 - pct / 100)
  group('percentage discount (parcel_models.dart:107)', () {
    test('the double version drifts; Money does not', () {
      // Verified drift, not a guess: 51 * (1 - 5/100) is one of many
      // ordinary price/discount pairs that lands off-cent. Plenty of
      // other pairs (299 at 15%) happen to be exact — which is what
      // makes this class of bug so hard to catch by hand.
      const minKes = 51.0;
      const pct = 5.0;

      final viaDouble = minKes * (1 - pct / 100);
      // Pin the actual defect so this test fails if Money regresses to
      // double arithmetic.
      expect(viaDouble, isNot(48.45));
      expect(viaDouble.toString(), '48.449999999999996');

      final viaMoney = Money.tryParse('51')!.discounted(pct);
      expect(viaMoney.cents, 4845);
      expect(viaMoney.format(), '48.45');
    });

    test('discount and percentage agree', () {
      final price = Money.shillings(1000);
      expect(price.percentage(15).cents, 15000);
      expect(price.discounted(15).cents, 85000);
      expect((price - price.percentage(15)), price.discounted(15));
    });

    test('rounds half away from zero at the cent', () {
      // 33.33% of 10.00 = 3.333 -> 3.33
      expect(Money.shillings(10).percentage(33.33).cents, 333);
      // 12.345% of 100.00 = 12.345 -> 12.35 (banker's rounding would give 12.34)
      expect(Money.shillings(100).percentage(12.345).cents, 1235);
    });
  });

  // complete_delivery_screen.dart:320,353 — the COD reconciliation a
  // courier runs on a doorstep holding somebody else's cash.
  group('COD reconciliation (complete_delivery_screen.dart:320,353)', () {
    test('the 0.004 epsilon workaround is no longer needed', () {
      // Reproduce the drift the epsilon was written to hide: a 3-item
      // COD order at 99.99 each, paid in full. The buyer owes nothing,
      // but the double subtraction reports a positive shortfall.
      var expectedDouble = 0.0;
      for (var i = 0; i < 3; i++) {
        expectedDouble += 99.99;
      }
      const paidDouble = 299.97;
      final shortDouble = paidDouble - expectedDouble;
      expect(shortDouble, greaterThan(0)); // a phantom shortfall
      expect(shortDouble, lessThan(0.004)); // ...which is why it was hidden

      // Exact: the same order, fully paid, is square — so the screen can
      // test `short.isPositive` with no epsilon at all.
      final expected = Money.sum(List.filled(3, Money.tryParse('99.99')!));
      final paid = Money.tryParse('299.97')!;
      expect(expected.cents, 29997);
      expect((expected - paid).isZero, isTrue);
      expect((expected - paid).isPositive, isFalse);
    });

    test('a real shortfall must not render as "KES 0 short"', () {
      // The shipped code computes the shortfall in double and prints it
      // with toStringAsFixed(0). A buyer who pays 2,499.99 against
      // 2,500.00 is one cent short — and is told they owe "KES 0".
      final shortDouble = 2500.0 - (2000.0 + 499.99);
      expect(shortDouble.toString(), '0.010000000000218279');
      expect(shortDouble.toStringAsFixed(0), '0'); // what the courier saw

      final short = Money.shillings(2500) -
          (Money.shillings(2000) + Money.tryParse('499.99')!);
      expect(short.cents, 1);
      expect(short.format(), '0.01');
      expect(short.isPositive, isTrue);
    });

    test('a genuine shortfall is reported exactly', () {
      final expected = Money.tryParse('2500.00')!;
      final paid = Money.tryParse('2450.50')!;
      final short = expected - paid;
      expect(short.cents, 4950);
      expect(short.format(), '49.50');
      expect(short.isPositive, isTrue);
    });

    test('overpayment is negative, not a hidden zero', () {
      final short = Money.shillings(2500) - Money.shillings(2600);
      expect(short.isNegative, isTrue);
      expect(short.cents, -10000);
      expect(short.absolute.format(), '100');
    });

    test('codExpectedKes = goods + delivery fee, exactly', () {
      // parcel_models.dart:364 — goods + double.tryParse(priceKes)
      final goods = Money.tryParse('2000.00')!;
      final fee = Money.tryParse('499.99')!;
      expect((goods + fee).format(), '2,499.99');
    });
  });

  // table_order_screen.dart:71 and self_checkout_screen.dart:54 both
  // accumulate a cart total in a double loop.
  group('cart accumulation (table_order_screen.dart:71)', () {
    test('the double loop drifts over a realistic cart; Money does not', () {
      final prices = List.filled(10, 0.1);
      var viaDouble = 0.0;
      for (final p in prices) {
        viaDouble += p;
      }
      expect(viaDouble, isNot(1.0)); // 0.9999999999999999

      final viaMoney = Money.sum(prices.map((_) => Money.fromCents(10)));
      expect(viaMoney.cents, 100);
      expect(viaMoney.format(), '1');
    });

    test('quantity multiplication is exact', () {
      final unit = Money.tryParse('33.33')!;
      expect((unit * 3).cents, 9999);
      expect((unit * 3).format(), '99.99');
    });

    test('summing an empty cart is zero, not an error', () {
      expect(Money.sum(const []), Money.zero);
    });
  });

  group('formatting', () {
    test('hides cents when they are zero, shows them when they are not', () {
      expect(Money.shillings(250).format(), '250');
      expect(Money.tryParse('250.50')!.format(), '250.50');
      expect(Money.tryParse('250.05')!.format(), '250.05');
    });

    test('forceCents always shows two places', () {
      expect(Money.shillings(250).format(forceCents: true), '250.00');
    });

    test('groups thousands', () {
      expect(Money.shillings(1000).format(), '1,000');
      expect(Money.shillings(12345).format(), '12,345');
      expect(Money.shillings(1234567).format(), '1,234,567');
      expect(Money.shillings(100).format(), '100');
    });

    test('negatives keep the sign outside the grouping', () {
      expect(Money.fromCents(-123456).format(), '-1,234.56');
    });

    test('toWire always round-trips', () {
      for (final raw in ['0.00', '1.05', '999.99', '-45.20', '1250.00']) {
        expect(Money.tryParse(raw)!.toWire(), raw);
      }
      expect(Money.tryParse('1,250.50')!.toWire(), '1250.50');
    });
  });

  group('value semantics', () {
    test('equal amounts are == and hash alike', () {
      expect(Money.shillings(100), Money.fromCents(10000));
      expect(Money.tryParse('100.00'), Money.fromJson(100.0));
      expect(
        Money.shillings(100).hashCode,
        Money.fromCents(10000).hashCode,
      );
    });

    test('sorts by amount', () {
      final amounts = [
        Money.shillings(300),
        Money.shillings(100),
        Money.shillings(200),
      ]..sort();
      expect(amounts.map((m) => m.cents), [10000, 20000, 30000]);
    });

    test('comparison operators', () {
      final a = Money.shillings(100);
      final b = Money.shillings(200);
      expect(a < b, isTrue);
      expect(a <= b, isTrue);
      expect(b > a, isTrue);
      expect(b >= a, isTrue);
      expect(a >= Money.shillings(100), isTrue);
    });
  });
}
