import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../theme/esoko_tokens.dart';
import 'esoko_empty_state.dart';
import 'esoko_error_view.dart';
import 'esoko_skeleton.dart';

/// EsokoAsyncView for slivers — the same never-wipe-data contract (data
/// wins over loading, empty gets EsokoEmptyState, errors get
/// EsokoErrorView with retry), but returning slivers so CustomScrollView
/// screens stop hand-rolling `.when` blocks that each forgot a different
/// state (silent `SizedBox.shrink` errors, bare spinners, layout shift).
class EsokoSliverAsyncView<T> extends StatelessWidget {
  const EsokoSliverAsyncView({
    super.key,
    required this.value,
    required this.data,
    this.isEmpty,
    this.emptyMessage,
    this.emptyIcon = Icons.inbox_outlined,
    this.onRetry,
  });

  final AsyncValue<T> value;
  final List<Widget> Function(BuildContext context, T data) data;
  final bool Function(T data)? isEmpty;
  final String? emptyMessage;
  final IconData emptyIcon;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (value.hasValue) {
      final v = value.requireValue;
      if (isEmpty != null && emptyMessage != null && isEmpty!(v)) {
        return SliverToBoxAdapter(child: EsokoEmptyState(message: emptyMessage!, icon: emptyIcon));
      }
      return SliverMainAxisGroup(slivers: data(context, v));
    }
    if (value.hasError) {
      final error = value.error;
      final message = error is ApiException ? error.message : 'Something went wrong. Pull to retry.';
      return SliverToBoxAdapter(child: EsokoErrorView(message: message, onRetry: onRetry));
    }
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s6),
        child: EsokoSkeletonList(),
      ),
    );
  }
}
