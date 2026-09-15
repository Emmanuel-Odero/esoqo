import 'package:flutter/material.dart';

import '../../core/theme/esoqo_tokens.dart';

/// Honest placeholder for a domain core-go doesn't serve yet (groups,
/// shopping, tickets — see docs/adr/0005-mobile-api-in-go.md's Phase 1).
/// Deliberately not backed by fabricated sample data: better an
/// admittedly-empty screen than a fake chama balance nobody can trust.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({
    super.key,
    required this.title,
    required this.icon,
    required this.description,
  });

  final String title;
  final IconData icon;
  final String description;

  @override
  Widget build(BuildContext context) {
    // Theme-derived, not the fixed EsoqoColors.text2/.text3 — this
    // sits directly on the scaffold background, which flips between
    // paper and darkSurface.
    final theme = Theme.of(context);
    final iconColor = theme.textTheme.bodyMedium?.color?.withValues(alpha: 0.7);
    final textColor = theme.textTheme.bodySmall?.color;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(EsoqoSpacing.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: iconColor),
            const SizedBox(height: EsoqoSpacing.s4),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: EsoqoSpacing.s2),
            Text(
              description,
              textAlign: TextAlign.center,
              style: TextStyle(color: textColor),
            ),
          ],
        ),
      ),
    );
  }
}
