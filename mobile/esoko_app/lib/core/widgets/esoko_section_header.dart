import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// The "Title" + subtitle heading atop nearly every list screen —
/// same headlineSmall + text2-coloured subtitle pairing every screen
/// used to retype for itself.
///
/// An optional [kicker] renders the web PageHeader's brand moment — a
/// green 3px rule + small caps label (see tokens.css `.ui-kicker`) —
/// giving a screen an intentional, quiet "above the title" marker.
class EsokoSectionHeader extends StatelessWidget {
  const EsokoSectionHeader({super.key, required this.title, this.subtitle, this.kicker});

  final String title;
  final String? subtitle;
  final String? kicker;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (kicker != null) ...[
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 20,
                height: 3,
                decoration: BoxDecoration(
                  color: EsokoColors.green,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: EsokoSpacing.s2),
              Text(
                kicker!.toUpperCase(),
                style: TextStyle(
                  color: EsokoColors.green,
                  fontFamily: EsokoFonts.display,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.4,
                ),
              ),
            ],
          ),
          const SizedBox(height: EsokoSpacing.s2),
        ],
        Text(title, style: theme.textTheme.headlineSmall),
        if (subtitle != null) ...[
          const SizedBox(height: EsokoSpacing.s1),
          Text(subtitle!, style: TextStyle(color: EsokoColors.text2, height: 1.4)),
        ],
      ],
    );
  }
}