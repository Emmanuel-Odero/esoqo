import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// Phone-first, tablet-decent body — centres [child] and caps its width
/// at [maxWidth] (Material 3's 840 expanded breakpoint by default) so a
/// phone layout doesn't stretch edge-to-edge on a tablet or foldable.
/// On phones the constraint never binds and the child lays out exactly
/// as before, which is why this is safe to wrap any existing screen
/// body in during the per-feature polish passes.
class EsoqoAdaptiveBody extends StatelessWidget {
  const EsoqoAdaptiveBody({
    super.key,
    required this.child,
    this.maxWidth = 840,
    this.padding = const EdgeInsets.symmetric(horizontal: EsoqoSpacing.s4),
  });

  final Widget child;
  final double maxWidth;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
