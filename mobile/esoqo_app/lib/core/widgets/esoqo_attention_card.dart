import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_card.dart';

/// A thing that wants something from you, with a deadline attached.
///
/// The shape the reorganisation proposal repeats on every screen that
/// has something time-pressured to say: a bill about to fall due, a
/// parcel arriving this afternoon, a withdrawal waiting on your
/// signature, a ticket that's half paid. Three lines in a fixed order,
/// because the order is the point:
///
///   [when]   — the deadline, in the accent colour. Read first.
///   [title]  — what it is.
///   [detail] — what you'd do about it.
///
/// The accent is semantic, per SCREEN_CONVENTIONS.md Rule 3 — green
/// when the thing is yours and on track, amber when it needs you
/// soon, red when it's already late. It colours the eyebrow and a
/// left edge rather than the whole card, so a column of these still
/// reads as a list rather than a stack of warning banners.
class EsoqoAttentionCard extends StatelessWidget {
  const EsoqoAttentionCard({
    super.key,
    required this.when,
    required this.title,
    this.detail,
    this.amountKes,
    this.accent = EsoqoColors.amber,
    this.progress,
    this.onTap,
  });

  /// The deadline line — "Due in 2 days", "Arriving by 4pm", "Today ·
  /// 14:30". Short enough to read before the title.
  final String when;

  final String title;
  final String? detail;

  /// An amount this card is about — "1450.00", without the unit.
  ///
  /// Separate from [detail] because it is *data*, not prose: it renders
  /// in the mono face with tabular figures, per EsoqoTypography.mono's
  /// own rule that every KES figure a person checks against cash in
  /// hand must have its digits line up. Callers used to pass
  /// `detail: 'KES ${b.amountKes}'`, which put the one number on the
  /// card into the reading face alongside route descriptions and
  /// addresses — three overdue bills in a column with no digit
  /// alignment between them.
  final String? amountKes;

  /// Semantic, not decorative — see the class doc.
  final Color accent;

  /// 0..1. Draws a fill under [detail] for the "target being filled
  /// in" cases (a part-paid ticket, a bill being funded by friends, a
  /// withdrawal collecting signatures). Null draws nothing at all
  /// rather than an empty bar.
  final double? progress;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // Same alpha-wash approach as EsoqoInlineNotice, for the same
    // reason: a fixed pastel reads as a light rectangle glued onto a
    // dark screen. Blending the accent over whatever surface is
    // actually behind it keeps this a tinted patch of *this* screen.
    final wash = accent.withValues(alpha: dark ? 0.16 : 0.09);

    return EsoqoCard(
      padding: EdgeInsets.zero,
      color: wash,
      onTap: onTap,
      // IntrinsicHeight, because the accent edge below stretches to
      // whatever height the text ends up needing — and `stretch` in a
      // parent that doesn't bound its height (a ListView child, which
      // is every use of this card) resolves to infinity and throws.
      // Three cards at most on any screen, so the extra layout pass is
      // not worth avoiding with a hand-measured fixed height that
      // would break at the first large text scale.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The accent edge. A Container rather than a Border so it
            // stays crisp at the card's own corner radius.
            Container(width: 3, color: accent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      when.toUpperCase(),
                      style: EsoqoTypography.eyebrow(color: accent),
                    ),
                    const SizedBox(height: EsoqoSpacing.s1),
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (amountKes != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        'KES $amountKes',
                        style: EsoqoTypography.mono(
                          fontSize: EsoqoTypeScale.body,
                          fontWeight: FontWeight.w600,
                          color: accent,
                        ),
                      ),
                    ],
                    if (detail != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        detail!,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                    if (progress != null) ...[
                      const SizedBox(height: EsoqoSpacing.s2),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
                        child: LinearProgressIndicator(
                          value: progress!.clamp(0, 1),
                          minHeight: 5,
                          backgroundColor: accent.withValues(alpha: 0.18),
                          valueColor: AlwaysStoppedAnimation(accent),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
