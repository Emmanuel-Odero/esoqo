import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// A live, present-tense PIN entry — used wherever core-go re-verifies
/// a PIN at the moment of the call (see SignWithdrawal's own "never a
/// client 'already verified' flag" comment on the Go side). Returns the
/// entered PIN string, or null if the sheet was dismissed.
Future<String?> showPinPromptDialog(
  BuildContext context, {
  required String title,
  String? message,
}) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message != null) ...[
            // Theme-derived, not the fixed EsokoColors.text2 — the
            // AlertDialog's surface flips between light and dark with
            // the theme.
            Text(
              message,
              style: TextStyle(
                color: Theme.of(context).textTheme.bodySmall?.color,
              ),
            ),
            const SizedBox(height: EsokoSpacing.s4),
          ],
          TextField(
            controller: controller,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(labelText: 'PIN'),
            onSubmitted: (v) => Navigator.of(context).pop(v),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Confirm'),
        ),
      ],
    ),
  );
}
