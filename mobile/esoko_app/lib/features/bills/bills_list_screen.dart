import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'add_bill_screen.dart';
import 'bill_models.dart';

final myBillsProvider = FutureProvider.autoDispose<List<BillRow>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/me/bills');
  final list = (res['bills'] as List?) ?? const [];
  return list.map((e) => BillRow.fromJson(e as Map<String, dynamic>)).toList();
});

/// Bills tab — GET /v1/me/bills, grouped Overdue / Due soon / Upcoming.
/// Track-and-remind only: this is an in-app indicator, never a push
/// notification, and marking something paid never moves any money —
/// see the Bill model's own doc comment on the Go side for why.
class BillsListScreen extends ConsumerWidget {
  const BillsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bills = ref.watch(myBillsProvider);
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myBillsProvider),
        child: EsokoAsyncView(
          value: bills,
          onRetry: () => ref.invalidate(myBillsProvider),
          data: (context, list) {
            final overdue = list.where((b) => b.overdue).toList();
            final dueSoon = list.where((b) => !b.overdue && b.dueSoon).toList();
            final upcoming = list.where((b) => !b.overdue && !b.dueSoon).toList();
            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s2),
                    child: EsokoSectionHeader(
                      title: 'Bills',
                      subtitle: 'Track what you owe and when — a reminder here, not a payment. Pay however you already do, then mark it paid.',
                    ),
                  ),
                ),
                if (list.isEmpty)
                  const SliverToBoxAdapter(
                    child: EsokoEmptyState(icon: Icons.receipt_long_outlined, message: 'No bills tracked yet.'),
                  )
                else ...[
                  if (overdue.isNotEmpty) _section(context, 'Overdue', overdue, EsokoColors.red),
                  if (dueSoon.isNotEmpty) _section(context, 'Due soon', dueSoon, EsokoColors.amber),
                  if (upcoming.isNotEmpty) _section(context, 'Upcoming', upcoming, EsokoColors.text2),
                ],
                const SliverToBoxAdapter(child: SizedBox(height: EsokoSpacing.s9)),
              ],
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final added = await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddBillScreen()));
          if (added == true) ref.invalidate(myBillsProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('Add bill'),
      ),
    );
  }

  Widget _section(BuildContext context, String title, List<BillRow> bills, Color accent) {
    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s4, EsokoSpacing.s5, EsokoSpacing.s2),
            child: Text(title, style: TextStyle(color: accent, fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.3)),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s4),
          sliver: SliverList.separated(
            itemCount: bills.length,
            separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
            itemBuilder: (context, i) => _BillCard(bill: bills[i]),
          ),
        ),
      ],
    );
  }
}

class _BillCard extends ConsumerStatefulWidget {
  const _BillCard({required this.bill});
  final BillRow bill;

  @override
  ConsumerState<_BillCard> createState() => _BillCardState();
}

class _BillCardState extends ConsumerState<_BillCard> {
  bool _paying = false;

  Future<void> _markPaid() async {
    final amount = double.tryParse(widget.bill.amountKes ?? '') ?? 0;
    setState(() => _paying = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/me/bills/${widget.bill.id}/pay', {'amountKes': amount});
      ref.invalidate(myBillsProvider);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  IconData _categoryIcon(String category) => switch (category) {
        'ELECTRICITY' => Icons.bolt_outlined,
        'WATER' => Icons.water_drop_outlined,
        'PAY_TV' => Icons.live_tv_outlined,
        'RENT' => Icons.home_outlined,
        'SCHOOL_FEES' => Icons.school_outlined,
        'INTERNET' => Icons.wifi_outlined,
        _ => Icons.receipt_outlined,
      };

  @override
  Widget build(BuildContext context) {
    final b = widget.bill;
    final dueLabel = b.overdue
        ? '${-b.daysUntilDue} day${-b.daysUntilDue == 1 ? '' : 's'} overdue'
        : b.daysUntilDue == 0
            ? 'Due today'
            : 'Due in ${b.daysUntilDue} day${b.daysUntilDue == 1 ? '' : 's'}';

    return EsokoCard(
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: EsokoColors.blueTint, shape: BoxShape.circle),
            child: Icon(_categoryIcon(b.category), color: EsokoColors.blue, size: 20),
          ),
          const SizedBox(width: EsokoSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(b.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(
                  '$dueLabel${b.amountKes != null ? ' · KES ${b.amountKes}' : ''}',
                  style: TextStyle(fontSize: 12, color: b.overdue ? EsokoColors.red : EsokoColors.text2),
                ),
                if (b.accountRef != null)
                  Text('Ref: ${b.accountRef}', style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
              ],
            ),
          ),
          _paying
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: _markPaid, child: const Text('Mark paid')),
        ],
      ),
    );
  }
}
