import 'package:flutter/material.dart';

/// The one payment-method toggle for every "M-Pesa / Voucher / Cash"
/// choice — wraps Material's SegmentedButton so the four hand-rolled
/// copies (fare_pay, checkout, contribute, schedule_booking) share one
/// call site and one button theme, instead of each re-deciding the
/// SegmentButton styling. Single-select, full-width for form rhythm.
class EsokoPaymentMethodToggle<T> extends StatelessWidget {
  const EsokoPaymentMethodToggle({
    super.key,
    required this.selected,
    required this.onChanged,
    required this.options,
  });

  /// The currently selected value.
  final T selected;

  /// Single-select callback → the newly picked value.
  final ValueChanged<T> onChanged;

  /// The (value, label) pairs to offer, in display order.
  final List<(T, String)> options;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<T>(
        segments: [
          for (final (value, label) in options)
            ButtonSegment(value: value, label: Text(label)),
        ],
        selected: {selected},
        showSelectedIcon: false,
        style: const ButtonStyle(
          visualDensity: VisualDensity(vertical: 2),
        ),
        onSelectionChanged: (s) => onChanged(s.first),
      ),
    );
  }
}