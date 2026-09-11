import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// Shared "this failed to load" treatment — icon, message, optional
/// retry. Used standalone and inside EsokoAsyncView's no-data-yet
/// error branch, replacing the bare `Text(e.message, color: red)`
/// every screen used to write for itself.
class EsokoErrorView extends StatelessWidget {
  const EsokoErrorView({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(EsokoSpacing.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline_rounded, size: 40, color: EsokoColors.red),
          const SizedBox(height: EsokoSpacing.s3),
          // Theme-derived, not the fixed EsokoColors.text2 — this
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
            const SizedBox(height: EsokoSpacing.s4),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}
