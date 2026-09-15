import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// Inline form error — icon + message in the theme's error colour, announced
/// assertively. Replaces the bare `Text(_error!, color: red)` every form
/// screen used to write for itself (12 sites): colour-only text is easy to
/// miss and silent to screen readers; this is that line, promoted once.
class EsoqoFormError extends StatelessWidget {
  const EsoqoFormError({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    return Semantics(
      liveRegion: true,
      label: 'Error: $message',
      child: Padding(
        padding: const EdgeInsets.only(top: EsoqoSpacing.s2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline_rounded, size: 16, color: error),
            const SizedBox(width: EsoqoSpacing.s2),
            Expanded(
              child: Text(message, style: TextStyle(color: error, fontSize: EsoqoTypeScale.meta)),
            ),
          ],
        ),
      ),
    );
  }
}
