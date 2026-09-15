import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_icon.dart';

/// The tinted icon+label pill used for a category or status tag —
/// found hand-rolled six times over (store cards, ticket cards, seat
/// legends) with the same shape (Container, alpha-tinted background,
/// EsoqoRadius.pill, Icon + Text row) before this. Callers already
/// compute the right semantic colour themselves (CategoryStyle,
/// TicketStyle, a plain EsoqoColors constant) — this just standardises
/// how that colour gets turned into a pill.
class EsoqoStatusPill extends StatelessWidget {
  const EsoqoStatusPill({
    super.key,
    required this.label,
    required this.color,
    this.icon,
    this.esoqoIcon,
  });

  final String label;
  final Color color;

  /// Legacy Material glyph — prefer [esoqoIcon] for anything new.
  final IconData? icon;

  /// Branded 24px stroke icon (see EsoqoIcon), shown at pill scale.
  /// Takes precedence over [icon] when both are given.
  final EsoqoIconName? esoqoIcon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: EsoqoSpacing.s2,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (esoqoIcon != null) ...[
            EsoqoIcon(esoqoIcon!, size: 12, color: color),
            const SizedBox(width: 4),
          ] else if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.labelSmall!.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}
