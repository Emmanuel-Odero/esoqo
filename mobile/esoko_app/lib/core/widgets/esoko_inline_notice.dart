import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_icon.dart';

/// A tinted icon+text banner for an inline caution/info note (a claim
/// that needs confirming, a broadcast that needs quorum, a slow-network
/// warning). Replaces the hand-rolled `Container(amberTint, ...) + Icon +
/// Text` found duplicated in contribute_screen.dart and
/// request_withdrawal_screen.dart — both hardcoded a *fixed* pastel hex
/// and a *fixed* muted-grey text colour, which only ever looked right on
/// a light background: in dark mode that fixed pastel sat on the dark
/// theme like a light card glued onto a dark screen, and the fixed grey
/// text lost contrast against it.
///
/// This version derives both from [color] and the current
/// [Brightness] instead of hardcoding either:
///  - the background is always a low-alpha wash of [color] — alpha-
///    blended over whatever surface is actually behind it (paper or
///    dark navy), so it reads as "a tinted patch of this screen", never
///    a foreign light rectangle.
///  - the icon stays [color] itself — the one place the semantic hue
///    should show through.
///  - the paragraph text is a neutral picked for the wash's own
///    lightness (near-navy on the light wash, near-white on the dark
///    one), not the semantic colour — a paragraph needs to read as
///    *text*, not as a coloured accent competing with it for attention.
class EsokoInlineNotice extends StatelessWidget {
  const EsokoInlineNotice({
    super.key,
    required this.message,
    required this.icon,
    this.color = EsokoColors.amber,
  });

  final String message;
  final EsokoIconName icon;

  /// The semantic accent — EsokoColors.amber for caution (the default),
  /// .blue for a neutral info note, .red for a warning.
  final Color color;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final background = color.withValues(alpha: dark ? 0.18 : 0.10);
    final textColor = dark
        ? Colors.white.withValues(alpha: 0.82)
        : EsokoColors.text2;
    return Container(
      padding: const EdgeInsets.all(EsokoSpacing.s3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(EsokoRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          EsokoIcon(icon, color: color, size: 18),
          const SizedBox(width: EsokoSpacing.s2),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: textColor, fontSize: 12, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
