import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// Shared "this failed to load" treatment — icon, message, optional
/// retry. Used standalone and inside EsoqoAsyncView's no-data-yet
/// error branch, replacing the bare `Text(e.message, color: red)`
/// every screen used to write for itself.
class EsoqoErrorView extends StatelessWidget {
  const EsoqoErrorView({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    // Scrollable, not just a bare Column: a long message (e.g. a
    // NETWORK_ERROR listing tried hosts) must never force a RenderFlex
    // overflow in whatever fixed-height context this renders inside —
    // it scrolls instead.
    return SingleChildScrollView(
      padding: const EdgeInsets.all(EsoqoSpacing.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline_rounded, size: 40, color: EsoqoColors.red),
          const SizedBox(height: EsoqoSpacing.s3),
          // Theme-derived, not the fixed EsoqoColors.text2 — this
          // renders directly on whatever's behind it (scaffold or
          // card), which flips between paper and darkSurface.
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Theme.of(context).textTheme.bodySmall?.color,
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: EsoqoSpacing.s4),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}

