import 'package:flutter/material.dart';

import 'esoqo_card.dart';
import 'esoqo_icon.dart';

/// The one list-row shape for tappable/informational summaries — avatar or
/// icon leading, title + subtitle, trailing widget or chevron. Replaces ~10
/// hand-rolled `Card + ListTile` variants (groups, history, bills, stores,
/// tickets) that each re-decided circle colours, margins and chevrons.
/// Built on EsoqoCard so the theme's border/radius/ripple always apply.
class EsoqoListTile extends StatelessWidget {
  const EsoqoListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.initial,
    this.icon,
    this.esoqoIcon,
    this.iconColor,
    this.iconBackground,
    this.trailing,
    this.onTap,
  }) : assert(
         leading != null ||
             initial != null ||
             icon != null ||
             esoqoIcon != null,
         'Provide leading, initial, icon or esoqoIcon',
       );

  final String title;
  final String? subtitle;
  final Widget? leading;
  final String? initial;

  /// Legacy Material glyph — prefer [esoqoIcon] (the branded stroke set)
  /// for anything new; this stays for the many call sites not migrated
  /// yet so this widget keeps working for both during the rollout.
  final IconData? icon;

  /// Branded 24px stroke icon (see EsoqoIcon) — the preferred leading
  /// glyph for anything redesigned after this pass. Takes precedence
  /// over [icon] when both are given.
  final EsoqoIconName? esoqoIcon;
  final Color? iconColor;
  final Color? iconBackground;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final avatar =
        leading ??
        CircleAvatar(
          backgroundColor: iconBackground ?? scheme.primaryContainer,
          child: initial != null
              ? Text(
                  initial!.isEmpty
                      ? '?'
                      : initial!.substring(0, 1).toUpperCase(),
                  style: TextStyle(
                    color: iconColor ?? scheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
                )
              : esoqoIcon != null
              ? EsoqoIcon(
                  esoqoIcon!,
                  color: iconColor ?? scheme.primary,
                  size: 20,
                )
              : Icon(icon, color: iconColor ?? scheme.primary, size: 20),
        );
    return EsoqoCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: avatar,
        title: Text(title),
        subtitle: subtitle == null
            ? null
            : Text(subtitle!, style: TextStyle(color: muted)),
        trailing:
            trailing ??
            (onTap == null
                ? null
                : EsoqoIcon(
                    EsoqoIconName.chevronRight,
                    color: muted,
                    size: 20,
                  )),
        onTap: onTap,
      ),
    );
  }
}
