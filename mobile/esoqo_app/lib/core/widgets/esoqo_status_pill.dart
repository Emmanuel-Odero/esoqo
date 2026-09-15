import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_icon.dart';

/// The tinted icon+label pill used for a category or status tag —
/// found hand-rolled six times over (store cards, ticket cards, seat
/// legends) with the same shape (Container, alpha-tinted background,
/// EsokoRadius.pill, Icon + Text row) before this. Callers already
/// compute the right semantic colour themselves (CategoryStyle,
/// TicketStyle, a plain EsokoColors constant) — this just standardises
/// how that colour gets turned into a pill.
class EsokoStatusPill extends StatelessWidget {
  const EsokoStatusPill({
    super.key,
    required this.label,
    required this.color,
    this.icon,
    this.esokoIcon,
  });

  final String label;
  final Color color;

  /// Legacy Material glyph — prefer [esokoIcon] for anything new.
  final IconData? icon;

  /// Branded 24px stroke icon (see EsokoIcon), shown at pill scale.
  /// Takes precedence over [icon] when both are given.
  final EsokoIconName? esokoIcon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: EsokoSpacing.s2,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(EsokoRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (esokoIcon != null) ...[
            EsokoIcon(esokoIcon!, size: 12, color: color),
            const SizedBox(width: 4),
          ] else if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
