import 'package:flutter/material.dart';

/// The one screen-title bar for every Scaffold that isn't a hero-image
/// SliverAppBar (store/listing detail keep their own — see those
/// files' own comments). Before this, every screen wrote a raw
/// `AppBar(title: Text('...'))`, which — since AppBarTheme never set
/// its own titleTextStyle — fell back to Material's default titleLarge:
/// regular weight, normal tracking, generic. It read as "not this
/// app's voice" next to everything else's deliberately bold, tight
/// headings (EsokoSectionHeader and friends).
///
/// The actual fix is EsokoTheme's own titleTextStyle (see
/// esoko_theme.dart's `_headline` helper, porting tokens.css's h1/h2/h3
/// rule: bold, tight tracking) — every AppBar picks that up
/// automatically now, this component included. EsokoAppBar exists so
/// there's one deliberate, named call site for "this is a screen
/// title" instead of a bare AppBar screens reach for by habit, and one
/// place to grow from later (a subtitle, a consistent action-icon
/// treatment) without another sweep through every screen.
class EsokoAppBar extends StatelessWidget implements PreferredSizeWidget {
  const EsokoAppBar({super.key, required this.title, this.titleWidget, this.actions, this.leading, this.centerTitle});

  final String title;
  /// Replaces [title] with a custom widget (e.g. a brand lockup) when set.
  final Widget? titleWidget;
  final List<Widget>? actions;
  final Widget? leading;
  final bool? centerTitle;

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: titleWidget ?? Text(title, overflow: TextOverflow.ellipsis),
      actions: actions,
      leading: leading,
      centerTitle: centerTitle,
    );
  }

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);
}
