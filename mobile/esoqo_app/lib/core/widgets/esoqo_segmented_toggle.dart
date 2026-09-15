import 'package:flutter/material.dart';

/// The one single-select segmented toggle for the whole app — wraps
/// Material's SegmentedButton so every hand-rolled copy shares one call
/// site and one button style, instead of each screen re-deciding the
/// SegmentedButton styling itself. Started life as
/// "EsoqoPaymentMethodToggle" (M-Pesa / Voucher / Cash, still its
/// biggest use) but the shape is generic — any "pick exactly one of a
/// few options" toggle (Parcels' Sent/Holding included) — so it's named
/// for what it does now, not just its original call site.
///
/// Reach for this before writing a bare `SegmentedButton` anywhere: an
/// un-styled one has shown up rendering with almost no visible height in
/// at least one screen that skipped this and wrote its own (see
/// SCREEN_CONVENTIONS.md) — the `ButtonStyle`/sizing below is what
/// avoids that, not something obvious from SegmentedButton's own
/// defaults.
///
/// `minimumSize`, not `visualDensity` — an earlier version used
/// `ButtonStyle(visualDensity: VisualDensity(vertical: 2))` to grow the
/// segments, but `SegmentedButton` can compute the layout size it
/// *reports* to its parent from a different code path than the size it
/// *paints*, and a density override widens that gap instead of closing
/// it — which is exactly what caused the collision this comment used to
/// warn about (a whole list item visually covering the toggle). A fixed
/// `minimumSize` narrowed that gap but didn't fully close it (still a
/// few logical pixels of paint bleeding past the reported layout box in
/// testing) — so this also wraps the button in a hard [ClipRect]: even
/// if `SegmentedButton`'s internal paint ever again disagrees with what
/// it reports for layout, this widget's own box is the true, enforced
/// boundary, and nothing can paint past it into whatever sits below.
class EsoqoSegmentedToggle<T> extends StatelessWidget {
  const EsoqoSegmentedToggle({
    super.key,
    required this.selected,
    required this.onChanged,
    required this.options,
  });

  /// The currently selected value.
  final T selected;

  /// Single-select callback → the newly picked value.
  final ValueChanged<T> onChanged;

  /// The (value, label) pairs to offer, in display order.
  final List<(T, String)> options;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: SizedBox(
        width: double.infinity,
        height: 44,
        child: SegmentedButton<T>(
          segments: [
            for (final (value, label) in options)
              ButtonSegment(value: value, label: Text(label)),
          ],
          selected: {selected},
          showSelectedIcon: false,
          style: SegmentedButton.styleFrom(
            minimumSize: const Size.fromHeight(44),
          ),
          onSelectionChanged: (s) => onChanged(s.first),
        ),
      ),
    );
  }
}
