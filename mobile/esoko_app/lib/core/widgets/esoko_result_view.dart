import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_button.dart';
import 'esoko_status_badge.dart';

/// Full-screen flow result — spinning/waiting, success or failure — for the
/// payment-style flows (checkout, ticket booking, contribution). Replaces
/// three hand-rolled `badge + title + message + button` blocks (~150 lines)
/// that each re-decided icon sizes, gaps and copy shape. Waiting and failed
/// states are announced via live regions.
class EsokoResultView extends StatelessWidget {
  const EsokoResultView.waiting({
    super.key,
    required this.title,
    required this.message,
    this.amountKes,
    this.waitingIcon = Icons.phone_android_rounded,
  }) : _kind = _Kind.waiting,
       successIcon = Icons.check_rounded,
       badgeColor = EsokoColors.blue,
       primaryLabel = null,
       onPrimary = null,
       secondaryLabel = null,
       onSecondary = null,
       errorMessage = null;

  const EsokoResultView.success({
    super.key,
    required this.title,
    required this.message,
    this.amountKes,
    required this.primaryLabel,
    required this.onPrimary,
    this.successIcon = Icons.check_rounded,
    this.badgeColor = EsokoColors.green,
  }) : _kind = _Kind.success,
       waitingIcon = Icons.check_rounded,
       secondaryLabel = null,
       onSecondary = null,
       errorMessage = null;

  const EsokoResultView.failure({
    super.key,
    this.errorMessage,
    required this.primaryLabel,
    required this.onPrimary,
    this.secondaryLabel,
    this.onSecondary,
  }) : _kind = _Kind.failure,
       title = null,
       message = null,
       amountKes = null,
       waitingIcon = Icons.priority_high_rounded,
       successIcon = Icons.priority_high_rounded,
       badgeColor = EsokoColors.red;

  final _Kind _kind;
  final String? title;
  final String? message;
  final String? amountKes;
  final IconData waitingIcon;
  final IconData successIcon;
  final Color badgeColor;
  final String? primaryLabel;
  final VoidCallback? onPrimary;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      label: title ?? errorMessage ?? 'Loading',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          EsokoStatusBadge(
            icon: _kind == _Kind.success ? successIcon : waitingIcon,
            color: badgeColor,
            spinning: _kind == _Kind.waiting,
          ),
          const SizedBox(height: EsokoSpacing.s4),
          if (title != null)
            Text(title!, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
          if (message != null) ...[
            const SizedBox(height: EsokoSpacing.s2),
            Text(message!, textAlign: TextAlign.center, style: TextStyle(color: muted)),
          ],
          if (errorMessage != null)
            Text(errorMessage!, textAlign: TextAlign.center),
          if (amountKes != null) ...[
            const SizedBox(height: EsokoSpacing.s4),
            Text(
              'KES $amountKes',
              style: TextStyle(color: scheme.primary, fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
          if (primaryLabel != null) ...[
            const SizedBox(height: EsokoSpacing.s6),
            EsokoButton.primary(expand: false, label: primaryLabel!, onPressed: onPrimary),
            if (secondaryLabel != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              OutlinedButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
            ],
          ],
        ],
      ),
    );
  }
}

enum _Kind { waiting, success, failure }
