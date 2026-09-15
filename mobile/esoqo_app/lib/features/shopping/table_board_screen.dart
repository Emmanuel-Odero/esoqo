import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'shopping_models.dart';
import 'stores_repository.dart';

final tableOrdersProvider = FutureProvider.autoDispose
    .family<List<TableOrderRow>, String>(
      (ref, slug) => ref.watch(storesRepositoryProvider).tableOrders(slug),
    );

final cashiersProvider = FutureProvider.autoDispose
    .family<List<CashierRow>, String>(
      (ref, slug) => ref.watch(storesRepositoryProvider).cashiers(slug),
    );

const _dineInSequence = ['ORDERED', 'PREPARING', 'SERVED', 'PAYING', 'CLOSED'];

/// The host stand's whole job: every table not yet closed, oldest
/// first, one tap to move a table forward and one tap to (re)assign a
/// waiter. Store-owner-scoped (see dbx/dine_in.go's own comment on why
/// there's no separate waiter PIN sign-in yet) — a FORBIDDEN response
/// here just means "you don't manage this store", same message the
/// server already gives.
class TableBoardScreen extends ConsumerWidget {
  const TableBoardScreen({super.key, required this.slug});
  final String slug;

  void _refreshAll(WidgetRef ref) {
    ref.invalidate(tableOrdersProvider(slug));
    ref.invalidate(cashiersProvider(slug));
  }

  Future<void> _addStaff(BuildContext context, WidgetRef ref) async {
    final nameController = TextEditingController();
    final pinController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add staff'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            TextField(
              controller: pinController,
              keyboardType: TextInputType.number,
              obscureText: true,
              maxLength: 6,
              decoration: const InputDecoration(labelText: 'PIN (6 digits)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (result != true) return;
    if (!context.mounted) return;
    try {
      await ref.read(storesRepositoryProvider).createCashier(
            slug: slug,
            name: nameController.text.trim(),
            pin: pinController.text.trim(),
          );
      ref.invalidate(cashiersProvider(slug));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Staff added.')),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(tableOrdersProvider(slug));
    return Scaffold(
      appBar: EsoqoAppBar(
        title: 'Table board',
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_alt_outlined),
            tooltip: 'Add staff',
            onPressed: () => _addStaff(context, ref),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => _refreshAll(ref),
        child: EsoqoAsyncView(
          value: orders,
          isEmpty: (list) => list.isEmpty,
          emptyMessage: 'No tables in progress right now.',
          emptyIcon: Icons.table_restaurant_outlined,
          onRetry: () => ref.invalidate(tableOrdersProvider(slug)),
          data: (context, list) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: ListView.separated(
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsoqoSpacing.s3),
                itemBuilder: (context, i) => EsoqoStagger(
                  index: i,
                  child: _TableOrderCard(
                    slug: slug,
                    order: list[i],
                    onChanged: () => _refreshAll(ref),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TableOrderCard extends ConsumerStatefulWidget {
  const _TableOrderCard({required this.slug, required this.order, required this.onChanged});
  final String slug;
  final TableOrderRow order;
  final VoidCallback onChanged;

  @override
  ConsumerState<_TableOrderCard> createState() => _TableOrderCardState();
}

class _TableOrderCardState extends ConsumerState<_TableOrderCard> {
  bool _busy = false;
  String? _error;

  Future<void> _advance() async {
    final next = _nextStatus(widget.order.dineInStatus);
    if (next == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(storesRepositoryProvider).updateDineInStatus(
            orderId: widget.order.orderId,
            status: next,
          );
      widget.onChanged();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickWaiter() async {
    final cashiers = await ref.read(cashiersProvider(widget.slug).future);
    if (!mounted) return;
    final chosen = await showModalBottomSheet<CashierRow>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: EsoqoSpacing.s4),
              child: EsoqoSubHeader('Assign waiter'),
            ),
            const SizedBox(height: EsoqoSpacing.s2),
            if (cashiers.isEmpty)
              Padding(
                padding: const EdgeInsets.all(EsoqoSpacing.s5),
                child: Column(
                  children: [
                    const Text('No staff added yet.'),
                    const SizedBox(height: EsoqoSpacing.s3),
                    EsoqoButton.secondary(
                      label: 'Add staff from the app bar',
                      expand: false,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
            for (final cashier in cashiers)
              EsoqoListTile(
                title: cashier.name,
                subtitle: cashier.role,
                icon: Icons.person_outline,
                onTap: () => Navigator.of(context).pop(cashier),
              ),
            const SizedBox(height: EsoqoSpacing.s3),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(storesRepositoryProvider).assignTable(
            slug: widget.slug,
            table: widget.order.tableLabel,
            cashierId: chosen.id,
          );
      widget.onChanged();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _nextStatus(String current) {
    final i = _dineInSequence.indexOf(current);
    if (i < 0 || i >= _dineInSequence.length - 1) return null;
    return _dineInSequence[i + 1];
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    final scheme = Theme.of(context).colorScheme;
    final (color, icon) = switch (o.dineInStatus) {
      'ORDERED' => (EsoqoColors.amber, Icons.receipt_long_outlined),
      'PREPARING' => (scheme.primary, Icons.soup_kitchen_outlined),
      'SERVED' => (scheme.primary, Icons.room_service_outlined),
      'PAYING' => (EsoqoColors.amber, Icons.payments_outlined),
      _ => (scheme.outline, Icons.check_circle_outline),
    };
    final next = _nextStatus(o.dineInStatus);
    return EsoqoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Table ${o.tableLabel}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              EsoqoStatusPill(label: o.dineInStatus, color: color, icon: icon),
            ],
          ),
          const SizedBox(height: 4),
          EsoqoAmountText(o.totalKes, fontSize: EsoqoTypeScale.subTitle),
          const SizedBox(height: EsoqoSpacing.s2),
          InkWell(
            onTap: _busy ? null : _pickWaiter,
            child: Row(
              children: [
                Icon(
                  Icons.person_outline,
                  size: 16,
                  color: Theme.of(context).textTheme.bodySmall?.color,
                ),
                const SizedBox(width: 6),
                Text(
                  o.waiterName ?? 'Tap to assign a waiter',
                  style: TextStyle(
                    fontSize: EsoqoTypeScale.meta,
                    color: Theme.of(context).textTheme.bodySmall?.color,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: EsoqoSpacing.s2),
            EsoqoFormError(message: _error!),
          ],
          if (next != null) ...[
            const SizedBox(height: EsoqoSpacing.s3),
            EsoqoButton.primary(
              expand: false,
              label: 'Mark as ${next.toLowerCase()}',
              loading: _busy,
              onPressed: _advance,
            ),
          ],
        ],
      ),
    );
  }
}
