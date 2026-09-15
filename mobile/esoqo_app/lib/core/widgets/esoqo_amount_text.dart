import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// The one money-amount treatment — `KES …` in the theme's primary colour,
/// bold, at the requested size. Replaces ~12 hand-rolled green `Text`
/// styles (26/18/16pt, w700/w800/bold mix) that each hardcoded
/// `EsoqoColors.green` — including in dark mode, where a fixed light-mode
/// green washes out. Colour comes from the scheme, so dark mode adapts.
///
/// Set in the mono typeface (tokens.css's --font-mono) with tabular
/// figures, not the ambient body/display font — every KES amount in the
/// app is a number a user checks against cash in hand, and digits need to
/// line up and read unambiguously (a "0" must never be mistaken for an
/// "8" on a phone screen in bright sun).
class EsoqoAmountText extends StatelessWidget {
  const EsoqoAmountText(
    this.amountKes, {
    super.key,
    this.fontSize = EsoqoTypeScale.cardTitle,
    this.prefix = 'KES ',
  });

  final String amountKes;
  final double fontSize;
  final String prefix;

  @override
  Widget build(BuildContext context) {
    return Text(
      '$prefix$amountKes',
      style: EsoqoTypography.mono(
        fontSize: fontSize,
        // w600 is the heaviest IBM Plex Mono weight bundled — asking
        // for w700 here got silently rounded down to this anyway (see
        // the clamp in EsoqoTypography.mono), so say what renders.
        fontWeight: FontWeight.w600,
        color: Theme.of(context).colorScheme.primary,
      ),
    );
  }
}
