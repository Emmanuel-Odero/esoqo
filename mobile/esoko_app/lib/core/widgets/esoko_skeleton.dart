import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// A shimmering placeholder bar — the Flutter port of web's
/// `.skel`/`.skel-card` (tokens.css `--line` fill + the same diagonal
/// white sweep). Replaces the bare `CircularProgressIndicator` the async
/// views used for first-load, so a screen "sketches out" its real layout
/// instead of flashing a spinner — the classic premium first-load.
///
/// Respects `MediaQuery.disableAnimations` (reduced motion) by showing a
/// static bar with no sweep.
class EsokoSkeleton extends StatefulWidget {
  const EsokoSkeleton({
    super.key,
    this.width,
    this.height = 14,
    this.radius = EsokoRadius.xs,
    this.brightness,
  });

  final double? width;
  final double height;
  final double radius;
  final Brightness? brightness;

  @override
  State<EsokoSkeleton> createState() => _EsokoSkeletonState();
}

class _EsokoSkeletonState extends State<EsokoSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: EsokoMotion.shimmer,
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = (widget.brightness ?? Theme.of(context).brightness) == Brightness.dark;
    final base = isDark ? EsokoColors.darkSurface2 : EsokoColors.line;
    final highlight = isDark
        ? EsokoColors.navy3.withValues(alpha: 0.5)
        : Colors.white.withValues(alpha: 0.7);
    final reduced = MediaQuery.disableAnimationsOf(context);

    return Container(
      width: widget.width ?? double.infinity,
      height: widget.height,
      decoration: BoxDecoration(
        color: base,
        borderRadius: BorderRadius.circular(widget.radius),
      ),
      clipBehavior: Clip.antiAlias,
      child: reduced
          ? null
          : AnimatedBuilder(
              animation: _controller,
              builder: (context, child) {
                final shift = _controller.value * 2.4 - 1.2;
                return Stack(
                  children: [
                    Positioned.fill(
                      child: Transform.translate(
                        offset: Offset(shift * MediaQuery.sizeOf(context).width, 0),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [Colors.transparent, highlight, Colors.transparent],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
    );
  }
}

/// A skeleton shaped like one EsokoCard — web's `.skel-card`: a title
/// bar plus a few full/part-width lines, so a list or detail screen's
/// "loading card" mirrors its final shape.
class EsokoSkeletonCard extends StatelessWidget {
  const EsokoSkeletonCard({super.key, this.lines = 3, this.leading = true});

  final int lines;
  final bool leading;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(EsokoSpacing.s4),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(EsokoRadius.lg),
        border: Border.all(color: EsokoColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (leading) ...[
                const EsokoSkeleton(width: 44, height: 44, radius: EsokoRadius.md),
                const SizedBox(width: EsokoSpacing.s3),
              ],
              Expanded(child: EsokoSkeleton(width: 220, height: 16)),
            ],
          ),
          const SizedBox(height: EsokoSpacing.s3),
          for (var i = 0; i < lines; i++)
            Padding(
              padding: const EdgeInsets.only(top: EsokoSpacing.s2),
              child: EsokoSkeleton(width: i == lines - 1 ? 140 : double.infinity, height: 12),
            ),
        ],
      ),
    );
  }
}

/// A convenience list of [EsokoSkeletonCard]s for list-screen first-load.
class EsokoSkeletonList extends StatelessWidget {
  const EsokoSkeletonList({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(EsokoSpacing.s6),
      physics: const NeverScrollableScrollPhysics(),
      // Sizes to its own content. Without this the ListView tries to
      // expand to fill, and in any unbounded parent — a Column, a
      // Stack laid out loose, another scrollable — that throws
      // "Vertical viewport was given unbounded height" during layout.
      // Being a placeholder that never scrolls, it has no reason to
      // want the extra space, and the throw is the silent kind: the
      // screen renders blank with nothing in the UI to say why (see
      // SCREEN_CONVENTIONS.md Rule 4 for the same failure mode).
      shrinkWrap: true,
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
      itemBuilder: (_, _) => const EsokoSkeletonCard(),
    );
  }
}
