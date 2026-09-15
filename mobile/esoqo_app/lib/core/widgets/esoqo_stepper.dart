import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// Pill quantity stepper — minus, value, plus. Replaces the duplicated
/// `Container(line, pill) + Row(IconButton − / value / IconButton +)`
/// in product detail and ticket booking. Both steppers enforce a minimum
/// of 1 and 44px touch targets via IconButton sizing.
class EsokoStepper extends StatelessWidget {
  const EsokoStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 1,
    this.max,
  });

  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int? max;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final cap = max;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: EsokoColors.line),
        borderRadius: BorderRadius.circular(EsokoRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.remove_rounded),
            tooltip: 'Decrease quantity',
            onPressed: value > min ? () => onChanged(value - 1) : null,
          ),
          SizedBox(
            width: 28,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w700),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Increase quantity',
            onPressed: cap == null || value < cap ? () => onChanged(value + 1) : null,
          ),
        ],
      ),
    );
  }
}
