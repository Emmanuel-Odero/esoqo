import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_amount_text.dart';

/// Tinted amount banner — label + big KES figure on a soft tinted
/// background. Replaces the hand-rolled `Container(s5, greenTint, lg) +
/// Column(12 text2 + 26 bold green)` balance/amount headers (groups,
/// withdrawals, tickets). Tint and figure colour come from the theme
/// scheme option, defaulting to primary — never a hardcoded light tint,
/// so dark mode adapts.
class EsokoAmountHeader extends StatelessWidget {
  const EsokoAmountHeader({
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
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Container(
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(EsokoRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: muted, fontSize: 12)),
          if (amountKes != null) ...[
            const SizedBox(height: 4),
            EsokoAmountText(amountKes!, fontSize: 26),
          ],
          if (detail != null) ...[
            const SizedBox(height: 4),
            Text(detail!, style: TextStyle(color: muted)),
          ],
          if (trailing != null) ...[
            const SizedBox(height: EsokoSpacing.s3),
            trailing!,
          ],
        ],
      ),
    );
  }
}
