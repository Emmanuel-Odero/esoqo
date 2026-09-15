import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_button.dart';
import 'esoqo_status_badge.dart';

/// Full-screen flow result — spinning/waiting, success or failure — for the
/// payment-style flows (checkout, ticket booking, contribution). Replaces
/// three hand-rolled `badge + title + message + button` blocks (~150 lines)
/// that each re-decided icon sizes, gaps and copy shape. Waiting and failed
/// states are announced via live regions.
class EsoqoResultView extends StatelessWidget {
  const EsoqoResultView.waiting({
    super.key,
    required this.title,
    required this.message,
    this.amountKes,
    this.waitingIcon = Icons.phone_android_rounded,
  }) : _kind = _Kind.waiting,
       successIcon = Icons.check_rounded,
       badgeColor = EsoqoColors.blue,
       primaryLabel = null,
       onPrimary = null,
       secondaryLabel = null,
       onSecondary = null,
       errorMessage = null;

  const EsoqoResultView.success({
    super.key,
    required this.title,
    required this.message,
    this.amountKes,
    required this.primaryLabel,
    required this.onPrimary,
    this.successIcon = Icons.check_rounded,
    this.badgeColor = EsoqoColors.green,
  }) : _kind = _Kind.success,
       waitingIcon = Icons.check_rounded,
       secondaryLabel = null,
       onSecondary = null,
       errorMessage = null;

  const EsoqoResultView.failure({
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
       badgeColor = EsoqoColors.red;

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
          EsoqoStatusBadge(
            icon: _kind == _Kind.success ? successIcon : waitingIcon,
            color: badgeColor,
            spinning: _kind == _Kind.waiting,
          ),
          const SizedBox(height: EsoqoSpacing.s4),
          if (title != null)
            Text(title!, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
          if (message != null) ...[
            const SizedBox(height: EsoqoSpacing.s2),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium!.copyWith(
                color: muted,
              ),
            ),
          ],
          if (errorMessage != null)
            Text(errorMessage!, textAlign: TextAlign.center),
          if (amountKes != null) ...[
            const SizedBox(height: EsoqoSpacing.s4),
            Text(
              'KES $amountKes',
              // An amount is data: mono, tabular figures — not the
              // ambient body face at an arbitrary 18/bold.
              style: EsoqoTypography.mono(
                fontSize: EsoqoTypeScale.cardTitle,
                fontWeight: FontWeight.w700,
                color: scheme.primary,
              ),
            ),
          ],
          if (primaryLabel != null) ...[
            const SizedBox(height: EsoqoSpacing.s6),
            EsoqoButton.primary(expand: false, label: primaryLabel!, onPressed: onPrimary),
            if (secondaryLabel != null) ...[
              const SizedBox(height: EsoqoSpacing.s3),
              OutlinedButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
            ],
          ],
        ],
      ),
    );
  }
}

enum _Kind { waiting, success, failure }
