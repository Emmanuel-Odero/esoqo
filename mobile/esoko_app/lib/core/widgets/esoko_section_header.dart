import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// The "Title" + subtitle heading atop nearly every list screen —
/// same headlineSmall + text2-coloured subtitle pairing every screen
/// used to retype for itself.
class EsokoSectionHeader extends StatelessWidget {
  const EsokoSectionHeader({super.key, required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        if (subtitle != null) ...[
          const SizedBox(height: EsokoSpacing.s1),
          Text(subtitle!, style: TextStyle(color: EsokoColors.text2)),
        ],
      ],
    );
  }
}
