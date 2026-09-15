import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_field.dart';
import 'esoko_button.dart';

/// Buyer identity + M-Pesa pay button — the exact block duplicated verbatim
/// between shopping checkout and ticket booking (`Your name` + `M-Pesa
/// phone` fields, then a `Pay with M-Pesa` button). One owner for labels,
/// hints, autofill and focus order from now on.
class EsokoPayerFields extends StatelessWidget {
  const EsokoPayerFields({
    super.key,
    required this.nameController,
    required this.msisdnController,
    required this.payLabel,
    required this.onPay,
    this.paying = false,
  });

  final TextEditingController nameController;
  final TextEditingController msisdnController;
  final String payLabel;
  final VoidCallback onPay;
  final bool paying;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EsokoField.name(
          controller: nameController,
          label: 'Your name',
        ),
        const SizedBox(height: EsokoSpacing.s3),
        EsokoField.phone(
          controller: msisdnController,
          label: 'M-Pesa phone number',
          onSubmitted: (_) => onPay(),
        ),
        const SizedBox(height: EsokoSpacing.s5),
        EsokoButton.primary(
          expand: false,
          label: payLabel,
          icon: Icons.lock_outline,
          loading: paying,
          onPressed: onPay,
        ),
      ],
    );
  }
}
