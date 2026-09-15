import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';
import 'esoqo_haptics.dart';

/// The one tappable/non-tappable card shape for a list-item summary
/// across the app — a thin wrapper around the theme's own Card (see
/// EsoqoTheme's cardTheme: 0 elevation, EsoqoRadius.lg, a line-colour
/// border) so it always inherits that styling rather than a screen
/// re-deciding its own border/elevation/radius.
///
/// When [onTap] is provided the card gets a premium press feel from the
/// brand's motion tokens: a quick scale-down under the finger while
/// pressed, and a soft "lift" (translate up + deeper shadow) on release
/// before settling back — echoing web's `.btn:active` / `.card` shadow
/// language without being loud.
class EsoqoCard extends StatefulWidget {
  const EsoqoCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(EsoqoSpacing.s3),
    this.color,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  /// Overrides the theme's card surface — used for tinted status cards
  /// (e.g. a verification result) that still want the shared shadow/border.
  final Color? color;

  @override
  State<EsoqoCard> createState() => _EsoqoCardState();
}

class _EsoqoCardState extends State<EsoqoCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: EsoqoMotion.medium,
    reverseDuration: EsoqoMotion.medium,
  );

  // 0 = resting · 0.5 = pressed (scaled down) · 1 = released (lifted).
  //
  // [_settleGeneration] guards the delayed settle: a rapid second tap
  // cancels the first tap's pending reverse instead of letting it fire
  // mid-press and visibly yank the card back down.
  int _settleGeneration = 0;
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onHighlightChanged(bool pressed) {
    // Touch down: scale down over the first half. We keep a single
    // controller where .5 is the "pressed" visual and 1.0 the "lift".
    if (mounted) {
      if (pressed) {
        _settleGeneration++;
        _controller.animateTo(0.5, curve: EsoqoMotion.easeOut);
      } else {
        // Released: lift briefly, then settle back to rest.
        final generation = ++_settleGeneration;
        _controller.animateTo(1.0, curve: EsoqoMotion.easeOut);
        Future<void>.delayed(EsoqoMotion.slow, () {
          if (mounted && generation == _settleGeneration) {
            _controller.reverse();
          }
        });
      }
    }
  }

  double get _scale => 1.0 - 0.02 * (_controller.value / 0.5).clamp(0.0, 1.0);
  double get _lift => -_liftCurve * 2.0;

  /// Lift only in the top half (0.5..1.0).
  double get _liftCurve {
    final t = (_controller.value - 0.5).clamp(0.0, 0.5) / 0.5;
    return Curves.easeOut.transform(t);
  }

  @override
  Widget build(BuildContext context) {
    final cardTheme = Theme.of(context).cardTheme;
    final shape = cardTheme.shape as RoundedRectangleBorder?;
    final borderRadius =
        (shape?.borderRadius as BorderRadius?) ??
        BorderRadius.circular(EsoqoRadius.lg);
    final baseColor =
        widget.color ??
        cardTheme.color ??
        Theme.of(context).colorScheme.surface;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final shadow = _liftCurve <= 0.0
            ? EsoqoShadows.card
            : EsoqoShadows.lifted;

        final card = Card(
          elevation: 0,
          color: baseColor,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: borderRadius,
            side: BorderSide(color: EsoqoColors.line),
          ),
          child: widget.onTap == null
              ? Padding(padding: widget.padding, child: widget.child)
                : InkWell(
                    borderRadius: borderRadius,
                    onHighlightChanged: _onHighlightChanged,
                    onTap: () {
                      EsoqoHaptics.tap();
                      widget.onTap!();
                    },
                  child: Padding(padding: widget.padding, child: widget.child),
                ),
        );

        return Transform.translate(
          offset: Offset(0, _lift),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: borderRadius,
              boxShadow: shadow,
            ),
            child: Transform.scale(scale: _scale, child: card),
          ),
        );
      },
    );
  }
}
