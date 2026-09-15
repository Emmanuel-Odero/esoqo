import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// A plain 1–5 star picker — first used by the parcel receipt
/// confirmation flow (rate the condition it arrived in) but generic
/// enough for any "rate this out of 5" moment. Nothing like it existed
/// before that feature; no star/rating widget or model was anywhere in
/// this app.
class EsoqoStarRating extends StatelessWidget {
  const EsoqoStarRating({
    super.key,
    required this.value,
    required this.onChanged,
    this.size = 32,
  });

  /// 0 means "nothing picked yet" — callers should treat 0 as invalid
  /// for submission, not as a real 1-star rating.
  final int value;
  final ValueChanged<int> onChanged;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          IconButton(
            onPressed: () => onChanged(i),
            icon: Icon(
              i <= value ? Icons.star_rounded : Icons.star_outline_rounded,
              color: color,
              size: size,
            ),
            padding: const EdgeInsets.symmetric(horizontal: EsoqoSpacing.s1),
            constraints: const BoxConstraints(),
            splashRadius: size,
          ),
      ],
    );
  }
}
