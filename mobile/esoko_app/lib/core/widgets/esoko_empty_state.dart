import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// Shared "nothing here yet" treatment — icon, message, optional
/// action button. Every screen with an empty list used to write its
/// own version of this (a bare Text, or store_list_screen.dart's old
/// private _EmptyState); this is that shape, promoted and reused
/// everywhere so an empty Bills tab and an empty Shopping tab read the
/// same way.
class EsokoEmptyState extends StatelessWidget {
  const EsokoEmptyState({super.key, required this.message, this.icon = Icons.inbox_outlined, this.action});

  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(EsokoSpacing.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 40, color: EsokoColors.text3),
          const SizedBox(height: EsokoSpacing.s3),
          Text(message, textAlign: TextAlign.center, style: TextStyle(color: EsokoColors.text2)),
          if (action != null) ...[
            const SizedBox(height: EsokoSpacing.s4),
            action!,
          ],
        ],
      ),
    );
  }
}
