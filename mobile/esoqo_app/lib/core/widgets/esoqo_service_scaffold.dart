import 'package:flutter/material.dart';

import 'esoqo_app_bar.dart';
import 'esoqo_quick_action_icon.dart';

/// The shared wrapper for the five Home-hub service destinations
/// (Shopping, Tickets, Transport, Groups, Bills). Before this, home_hub
/// hand-rolled `Scaffold(appBar: EsoqoAppBar, body: SafeArea(screen))`
/// inline at every push site, and the service tile's icon just vanished
/// on navigation.
///
/// This keeps that exact structure — the destinations stay bar-less
/// Scaffolds of their own (see TransportScreen's own comment on why) —
/// but the app-bar title carries a small [EsoqoQuickActionIcon] wrapped
/// in a [Hero] with the same [heroTag] as the tile's leading icon, so
/// the service mark flies from the tile into the bar: the "moderate &
/// tasteful" hero moment across all five pushes.
class EsoqoServiceScaffold extends StatelessWidget {
  const EsoqoServiceScaffold({
    super.key,
    required this.title,
    required this.icon,
    required this.heroTag,
    required this.child,
    this.bottom,
  });

  final String title;
  final IconData icon;
  final String heroTag;
  final Widget child;

  /// A tab strip attached under the title — see EsoqoAppBar.bottom's own
  /// comment for why a same-screen toggle belongs here, not floating in
  /// the body.
  final PreferredSizeWidget? bottom;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: EsoqoAppBar(
        title: title,
        titleWidget: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Hero(
              tag: heroTag,
              child: EsoqoQuickActionIcon(icon: icon, size: 32),
            ),
            const SizedBox(width: 10),
            Flexible(child: Text(title, overflow: TextOverflow.ellipsis)),
          ],
        ),
        bottom: bottom,
      ),
      body: SafeArea(child: child),
    );
  }
}
