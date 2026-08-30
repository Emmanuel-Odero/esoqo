import 'package:flutter/material.dart';

import '../../core/theme/esoko_tokens.dart';

/// Honest placeholder for a domain core-go doesn't serve yet (groups,
/// shopping, tickets — see docs/adr/0005-mobile-api-in-go.md's Phase 1).
/// Deliberately not backed by fabricated sample data: better an
/// admittedly-empty screen than a fake chama balance nobody can trust.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title, required this.icon, required this.description});

  final String title;
  final IconData icon;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: EsokoColors.text3),
            const SizedBox(height: EsokoSpacing.s4),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: EsokoSpacing.s2),
            Text(
              description,
              textAlign: TextAlign.center,
              style: TextStyle(color: EsokoColors.text2),
            ),
          ],
        ),
      ),
    );
  }
}
