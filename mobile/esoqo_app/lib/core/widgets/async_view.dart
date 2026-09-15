import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../theme/esoko_tokens.dart';
import 'esoko_empty_state.dart';
import 'esoko_error_view.dart';
import 'esoko_icon.dart';
import 'esoko_skeleton.dart';

/// The shared shape for "a screen watching one FutureProvider" — every
/// screen used to write its own `provider.when(loading: ..., error:
/// ..., data: ...)`, each slightly different (spinner sizing, error
/// copy, whether an empty list got its own treatment at all). This is
/// that block, written once:
///
/// - No data yet, still loading → a centred spinner.
/// - No data yet, failed → a retry-capable EsokoErrorView.
/// - Data present (even mid-refresh, e.g. after a pull-to-refresh
///   invalidate) → always the data builder. A refetch never wipes what
///   was already on screen — that flash-to-spinner is what makes a
///   refresh feel like a full reload, so this widget deliberately
///   never lets isLoading override an existing value.
/// - Data present but empty → EsokoEmptyState, via isEmpty/emptyMessage.
class EsokoAsyncView<T> extends StatelessWidget {
  const EsokoAsyncView({
    super.key,
    required this.value,
    required this.data,
    this.isEmpty,
    this.emptyMessage,
    this.emptyIcon = Icons.inbox_outlined,
    this.emptyEsokoIcon,
    this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) data;
  final bool Function(T data)? isEmpty;
  final String? emptyMessage;

  /// Legacy Material glyph — prefer [emptyEsokoIcon] for anything new.
  final IconData emptyIcon;

  /// Branded 24px stroke icon (see EsokoIcon) for the empty state. Takes
  /// precedence over [emptyIcon] when both are given.
  final EsokoIconName? emptyEsokoIcon;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final Widget child;
    final String state;
    if (value.hasValue) {
      final v = value.requireValue;
      if (isEmpty != null && emptyMessage != null && isEmpty!(v)) {
        state = 'empty';
        child = EsokoEmptyState(
          message: emptyMessage!,
          icon: emptyIcon,
          esokoIcon: emptyEsokoIcon,
        );
      } else {
        state = 'data';
        child = data(context, v);
      }
    } else if (value.hasError) {
      final error = value.error;
      final message = error is ApiException
          ? error.message
          : 'Something went wrong. Pull to retry.';
      state = 'error';
      child = EsokoErrorView(message: message, onRetry: onRetry);
    } else {
      state = 'loading';
      child = const EsokoSkeletonList();
    }
    // Cross-fade between lifecycle states (skeleton → data, data →
    // error) instead of snapping — the transition itself is part of the
    // polish. Keyed by state so a data→data refresh doesn't replay it,
    // and skipped entirely under reduced motion.
    final reduced = MediaQuery.disableAnimationsOf(context);
    return AnimatedSwitcher(
      duration: reduced ? Duration.zero : EsokoMotion.medium,
      switchInCurve: EsokoMotion.easeOut,
      switchOutCurve: EsokoMotion.easeOut,
      child: KeyedSubtree(key: ValueKey(state), child: child),
    );
  }
}
