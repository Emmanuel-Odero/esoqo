import 'package:flutter/material.dart';

/// One KES amount, entered fast — a numeric field, not a form. Every
/// "+contribute" moment in the app (a tout's cash tally, a top-up
/// against an instalment plan, and eventually a bill contribution) is
/// the same shape: one number, one confirm. Returns the amount, or null
/// if the sheet was dismissed.
Future<double?> showAmountDialog(
  BuildContext context, {
  required String title,
  String label = 'Amount',
  String prefixText = 'KES ',
}) {
  final controller = TextEditingController();
  return showDialog<double>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(prefixText: prefixText, labelText: label),
        onSubmitted: (v) => Navigator.of(context).pop(double.tryParse(v.trim())),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(double.tryParse(controller.text.trim())),
          child: const Text('Record'),
        ),
      ],
    ),
  );
}
