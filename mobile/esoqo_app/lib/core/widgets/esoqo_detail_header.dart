import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_amount_text.dart';

/// Tinted amount banner — label + big KES figure on a soft tinted
/// background. Replaces the hand-rolled `Container(s5, greenTint, lg) +
/// Column(12 text2 + 26 bold green)` balance/amount headers (groups,
/// withdrawals, tickets). Tint and figure colour come from the theme
/// scheme option, defaulting to primary — never a hardcoded light tint,
/// so dark mode adapts.
class EsoqoAmountHeader extends StatelessWidget {
  const EsoqoAmountHeader({
    super.key,
    required this.label,
    this.amountKes,
    this.detail,
    this.trailing,
  });

  final String label;
  final String? amountKes;
  final String? detail;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(EsoqoSpacing.s5),
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(EsoqoRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The label over a big amount is furniture, not prose — label
          // voice, so it reads as a caption rather than a short sentence.
          Text(label, style: text.labelMedium),
          if (amountKes != null) ...[
            const SizedBox(height: 4),
            EsoqoAmountText(amountKes!, fontSize: EsoqoTypeScale.pageTitle),
          ],
          if (detail != null) ...[
            const SizedBox(height: 4),
            Text(detail!, style: text.bodySmall),
          ],
          if (trailing != null) ...[
            const SizedBox(height: EsoqoSpacing.s3),
            trailing!,
          ],
        ],
      ),
    );
  }
}
