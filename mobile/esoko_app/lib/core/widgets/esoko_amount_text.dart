import 'package:flutter/material.dart';

/// The one money-amount treatment — `KES …` in the theme's primary colour,
/// bold, at the requested size. Replaces ~12 hand-rolled green `Text`
/// styles (26/18/16pt, w700/w800/bold mix) that each hardcoded
/// `EsokoColors.green` — including in dark mode, where a fixed light-mode
/// green washes out. Colour comes from the scheme, so dark mode adapts.
class EsokoAmountText extends StatelessWidget {
  const EsokoAmountText(this.amountKes, {super.key, this.fontSize = 18, this.prefix = 'KES '});

  final String amountKes;
  final double fontSize;
  final String prefix;

  @override
  Widget build(BuildContext context) {
    return Text(
      '$prefix$amountKes',
      style: TextStyle(
        color: Theme.of(context).colorScheme.primary,
        fontWeight: FontWeight.bold,
        fontSize: fontSize,
      ),
    );
  }
}
