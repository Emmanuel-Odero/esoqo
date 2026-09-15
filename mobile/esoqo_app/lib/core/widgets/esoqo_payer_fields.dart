import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_field.dart';
import 'esoqo_button.dart';

/// Buyer identity + M-Pesa pay button — the exact block duplicated verbatim
/// between shopping checkout and ticket booking (`Your name` + `M-Pesa
/// phone` fields, then a `Pay with M-Pesa` button). One owner for labels,
/// hints, autofill and focus order from now on.
class EsoqoPayerFields extends StatelessWidget {
  const EsoqoPayerFields({
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
        EsoqoField.name(
          controller: nameController,
          label: 'Your name',
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoField.phone(
          controller: msisdnController,
          label: 'M-Pesa phone number',
          onSubmitted: (_) => onPay(),
        ),
        const SizedBox(height: EsoqoSpacing.s5),
        EsoqoButton.primary(
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
