import 'package:flutter/material.dart';

/// In-page section heading (`titleLarge`) — "Members", "History",
/// "Products". Replaces 20+ raw `Text(..., titleLarge/titleMedium)`
/// one-liners so every section inside a screen carries the same voice.
/// (Top-of-screen title + subtitle stays EsoqoSectionHeader.)
class EsoqoSubHeader extends StatelessWidget {
  const EsoqoSubHeader(this.title, {super.key, this.color});

  final String title;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(context).textTheme.titleLarge?.copyWith(color: color),
    );
  }
}
