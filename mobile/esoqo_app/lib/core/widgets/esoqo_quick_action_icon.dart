import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// The 44×44 "quick action" icon tile — primaryContainer background,
/// primary icon, medium radius. Found hand-rolled three times over
/// (transport_screen._TileIcon, scan_sheet._SheetIcon,
/// home_hub_screen._ServiceIcon) with the same Container + BoxDecoration
/// block before this; this standardises how a tappable service/sheet row
/// leading icon is drawn.
class EsoqoQuickActionIcon extends StatelessWidget {
  const EsoqoQuickActionIcon({super.key, required this.icon, this.size = 44});

  final IconData icon;
  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(EsoqoRadius.md),
      ),
      child: Icon(icon, color: scheme.primary, size: size * 0.5),
    );
  }
}