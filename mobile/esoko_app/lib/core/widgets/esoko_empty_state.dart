import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_icon.dart';

/// Shared "nothing here yet" treatment — a dashed-border tile with an
/// icon in a white box, matching web's `.empty` / `.empty-ic` (tokens.css:
/// dashed --line border on paper, icon in a white 48px rounded tile).
/// Every screen with an empty list used to write its own version of this;
/// this is that shape, promoted and reused everywhere.
class EsokoEmptyState extends StatelessWidget {
  const EsokoEmptyState({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.esokoIcon,
    this.action,
  });

  final String message;

  /// Legacy Material glyph — prefer [esokoIcon] for anything new.
  final IconData icon;

  /// Branded 24px stroke icon (see EsokoIcon). Takes precedence over
  /// [icon] when both are given.
  final EsokoIconName? esokoIcon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    // EsokoColors.text2/.text3 are tuned for light-mode paper — fixed
    // hex values that don't re-derive for a dark surface. The theme's
    // own bodyMedium/bodySmall colours do (Material3's ColorScheme
    // computes a properly-contrasting muted tone per brightness), so
    // this pulls from there instead of hardcoding either.
    final theme = Theme.of(context);
    final iconColor = theme.textTheme.bodyMedium?.color?.withValues(alpha: 0.7);
    final textColor = theme.textTheme.bodySmall?.color;
    return Padding(
      padding: const EdgeInsets.all(EsokoSpacing.s6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: theme.cardTheme.color ?? Colors.white,
              borderRadius: BorderRadius.circular(EsokoRadius.lg),
              border: Border.all(color: EsokoColors.line),
            ),
            child: Center(
              child: esokoIcon != null
                  ? EsokoIcon(esokoIcon!, size: 22, color: iconColor)
                  : Icon(icon, size: 22, color: iconColor),
            ),
          ),
          const SizedBox(height: EsokoSpacing.s4),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: textColor, fontSize: 14.5, height: 1.45),
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
