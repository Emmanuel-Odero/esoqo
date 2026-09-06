import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// Shared "nothing here yet" treatment — a dashed-border tile with an
/// icon in a white box, matching web's `.empty` / `.empty-ic` (tokens.css:
/// dashed --line border on paper, icon in a white 48px rounded tile).
/// Every screen with an empty list used to write its own version of this;
/// this is that shape, promoted and reused everywhere.
class EsokoEmptyState extends StatelessWidget {
  const EsokoEmptyState({super.key, required this.message, this.icon = Icons.inbox_outlined, this.action});

  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(EsokoSpacing.s6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: Theme.of(context).cardTheme.color ?? Colors.white,
              borderRadius: BorderRadius.circular(EsokoRadius.lg),
              border: Border.all(color: EsokoColors.line),
            ),
            child: Icon(icon, size: 22, color: EsokoColors.text3),
          ),
          const SizedBox(height: EsokoSpacing.s4),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: EsokoColors.text2, fontSize: 14.5, height: 1.45),
          ),
          if (action != null) ...[
            const SizedBox(height: EsokoSpacing.s4),
            action!,
          ],
        ],
      ),
    );
  }
}