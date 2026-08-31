import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import 'esoko_empty_state.dart';
import 'esoko_error_view.dart';

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
    this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) data;
  final bool Function(T data)? isEmpty;
  final String? emptyMessage;
  final IconData emptyIcon;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (value.hasValue) {
      final v = value.requireValue;
      if (isEmpty != null && emptyMessage != null && isEmpty!(v)) {
        return EsokoEmptyState(message: emptyMessage!, icon: emptyIcon);
      }
      return data(context, v);
    }
    if (value.hasError) {
      final error = value.error;
      final message = error is ApiException ? error.message : 'Something went wrong. Pull to retry.';
      return EsokoErrorView(message: message, onRetry: onRetry);
    }
    return const Center(child: CircularProgressIndicator());
  }
}
