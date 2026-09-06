import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';
import 'esoko_form_field.dart';
import 'esoko_loading_button.dart';

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
        EsokoFormField(
          controller: nameController,
          label: 'Your name',
          icon: Icons.person_outline,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.name],
        ),
        const SizedBox(height: EsokoSpacing.s3),
        EsokoFormField(
          controller: msisdnController,
          label: 'M-Pesa phone number',
          hint: '+254 7…',
          icon: Icons.phone_iphone_outlined,
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.telephoneNumber],
          onSubmitted: (_) => onPay(),
        ),
        const SizedBox(height: EsokoSpacing.s5),
        EsokoLoadingButton(
          label: payLabel,
          icon: Icons.lock_outline,
          loading: paying,
          onPressed: onPay,
        ),
      ],
    );
  }
}
