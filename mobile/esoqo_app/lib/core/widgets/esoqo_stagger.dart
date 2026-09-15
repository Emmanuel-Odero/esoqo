import 'package:flutter/material.dart';

import '../theme/esoqo_tokens.dart';

/// Staggered list entrance — wrap each item built by a `ListView`/`Column`
/// in one of these with its [index] and items fade+rise in sequence
/// instead of popping onto the screen all at once. The per-item delay is
/// capped ([maxDelay]) so a 50-row list doesn't keep animating for
/// seconds; later items simply arrive together.
///
/// Respects reduced motion by rendering the child with no animation at
/// all. One controller per item, each disposed with its own State, so
/// this stays cheap even in long lists.
class EsoqoStagger extends StatefulWidget {
  const EsoqoStagger({
    super.key,
    required this.index,
    required this.child,
    this.perItem = const Duration(milliseconds: 45),
    this.maxDelay = const Duration(milliseconds: 315),
  });

  final int index;
  final Widget child;
  final Duration perItem;
  final Duration maxDelay;

  @override
  State<EsoqoStagger> createState() => _EsoqoStaggerState();
}

class _EsoqoStaggerState extends State<EsoqoStagger>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: EsoqoMotion.slow,
  );

  @override
  void initState() {
    super.initState();
    final delay = Duration(
      milliseconds: (widget.index * widget.perItem.inMilliseconds)
          .clamp(0, widget.maxDelay.inMilliseconds),
    );
    Future<void>.delayed(delay).then((_) {
      if (mounted) _controller.forward();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final curved = CurvedAnimation(
      parent: _controller,
      curve: EsoqoMotion.easeOut,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.05),
          end: Offset.zero,
        ).animate(curved),
        child: widget.child,
      ),
    );
  }
}
