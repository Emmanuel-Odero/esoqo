import 'package:flutter/material.dart';

import 'esoko_card.dart';

/// The one list-row shape for tappable/informational summaries — avatar or
/// icon leading, title + subtitle, trailing widget or chevron. Replaces ~10
/// hand-rolled `Card + ListTile` variants (groups, history, bills, stores,
/// tickets) that each re-decided circle colours, margins and chevrons.
/// Built on EsokoCard so the theme's border/radius/ripple always apply.
class EsokoListTile extends StatelessWidget {
  const EsokoListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.initial,
    this.icon,
    this.iconColor,
    this.iconBackground,
    this.trailing,
    this.onTap,
  }) : assert(leading != null || initial != null || icon != null,
            'Provide leading, initial or icon');

  final String title;
  final String? subtitle;
  final Widget? leading;
  final String? initial;
  final IconData? icon;
  final Color? iconColor;
  final Color? iconBackground;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final avatar = leading ??
        CircleAvatar(
          backgroundColor: iconBackground ?? scheme.primaryContainer,
          child: initial != null
              ? Text(
                  initial!.isEmpty ? '?' : initial!.substring(0, 1).toUpperCase(),
                  style: TextStyle(color: iconColor ?? scheme.primary, fontWeight: FontWeight.w700),
                )
              : Icon(icon, color: iconColor ?? scheme.primary, size: 20),
        );
    return EsokoCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: avatar,
        title: Text(title),
        subtitle: subtitle == null ? null : Text(subtitle!, style: TextStyle(color: muted)),
        trailing: trailing ?? (onTap == null ? null : const Icon(Icons.chevron_right_rounded)),
        onTap: onTap,
      ),
    );
  }
}
