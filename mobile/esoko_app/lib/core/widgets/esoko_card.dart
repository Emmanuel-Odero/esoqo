import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// The one tappable/non-tappable card shape for a list-item summary
/// across the app — a thin wrapper around the theme's own Card (see
/// EsokoTheme's cardTheme: 0 elevation, EsokoRadius.lg, a line-colour
/// border) so it always inherits that styling rather than a screen
/// re-deciding its own border/elevation/radius. Before this, some
/// screens used a bare Card while others (store_list_screen.dart's old
/// _StoreCard) hand-rolled Material+InkWell+Container to get a tap
/// ripple, drifting from the theme in the process — this gives every
/// screen the tap ripple *and* the theme's own shape, in one call.
class EsokoCard extends StatelessWidget {
  const EsokoCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(EsokoSpacing.s3)});

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final cardTheme = Theme.of(context).cardTheme;
    final shape = cardTheme.shape as RoundedRectangleBorder?;
    final borderRadius = (shape?.borderRadius as BorderRadius?) ?? BorderRadius.circular(EsokoRadius.lg);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? Padding(padding: padding, child: child)
          : InkWell(
              onTap: onTap,
              borderRadius: borderRadius,
              child: Padding(padding: padding, child: child),
            ),
    );
  }
}
