import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// The "Title" + subtitle heading atop nearly every list screen —
/// same headlineSmall + text2-coloured subtitle pairing every screen
/// used to retype for itself.
///
/// An optional [kicker] renders the web PageHeader's brand moment — a
/// green 3px rule + small caps label (see tokens.css `.ui-kicker`) —
/// giving a screen an intentional, quiet "above the title" marker.
class EsoqoSectionHeader extends StatelessWidget {
  const EsoqoSectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.kicker,
  });

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
                  color: EsoqoColors.green,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: EsoqoSpacing.s2),
              Text(
                kicker!.toUpperCase(),
                style: EsoqoTypography.eyebrow(color: EsoqoColors.green),
              ),
            ],
          ),
          const SizedBox(height: EsoqoSpacing.s2),
        ],
        Text(title, style: theme.textTheme.headlineSmall),
        if (subtitle != null) ...[
          const SizedBox(height: EsoqoSpacing.s1),
          // Theme-derived, not the fixed EsoqoColors.text2 — this
          // heading sits atop nearly every list screen's scaffold
          // background, which flips between paper and darkSurface.
          Text(
            subtitle!,
            style: theme.textTheme.bodySmall?.copyWith(height: 1.4),
          ),
        ],
      ],
    );
  }
}
