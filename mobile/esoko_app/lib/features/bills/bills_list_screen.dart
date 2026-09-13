import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'add_bill_screen.dart';
import 'bill_funding_screen.dart';
import 'bill_models.dart';
import 'bills_repository.dart';

final myBillsProvider = FutureProvider.autoDispose<List<BillRow>>(
  (ref) => ref.watch(billsRepositoryProvider).myBills(),
);

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
            final upcoming = list
                .where((b) => !b.overdue && !b.dueSoon)
                .toList();
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 840),
                child: CustomScrollView(
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          EsokoSpacing.s5,
                          EsokoSpacing.s5,
                          EsokoSpacing.s5,
                          EsokoSpacing.s2,
                        ),
                        child: EsokoPageLead(
                          'Track what you owe and when — a reminder here, not a payment. Pay however you already do, then mark it paid.',
                        ),
                      ),
                    ),
                    if (list.isEmpty)
                      const SliverToBoxAdapter(
                        child: EsokoEmptyState(
                          icon: Icons.receipt_long_outlined,
                          message: 'No bills tracked yet.',
                        ),
                      )
                    else ...[
                      if (overdue.isNotEmpty)
                        _section(context, 'Overdue', overdue, EsokoColors.red),
                      if (dueSoon.isNotEmpty)
                        _section(
                          context,
                          'Due soon',
                          dueSoon,
                          EsokoColors.amber,
                        ),
                      if (upcoming.isNotEmpty)
                        // No accent colour — "Upcoming" isn't a status
                        // like Overdue/Due soon, so it gets the
                        // heading's normal (theme-adaptive) colour
                        // instead of a fixed EsokoColors.text2, which
                        // only had readable contrast against a dark
                        // background, not light paper.
                        _section(context, 'Upcoming', upcoming, null),
                    ],
                    const SliverToBoxAdapter(
                      child: SizedBox(height: EsokoSpacing.s9),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final added = await Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => const AddBillScreen()));
          if (added == true) ref.invalidate(myBillsProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('Add bill'),
      ),
    );
  }

  Widget _section(
    BuildContext context,
    String title,
    List<BillRow> bills,
    Color? accent,
  ) {
    return SliverMainAxisGroup(
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              EsokoSpacing.s5,
              EsokoSpacing.s4,
              EsokoSpacing.s5,
              EsokoSpacing.s2,
            ),
            child: EsokoSubHeader(title, color: accent),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s4),
          sliver: SliverList.separated(
            itemCount: bills.length,
            separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
            itemBuilder: (context, i) => EsokoStagger(
              index: i,
              child: _BillCard(bill: bills[i]),
            ),
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
    EsokoHaptics.tap();
    try {
      await ref.read(billsRepositoryProvider).markPaid(widget.bill.id, amount);
      ref.invalidate(myBillsProvider);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
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

    final tile = EsokoListTile(
      title: b.label,
      subtitle:
          '$dueLabel${b.amountKes != null ? ' · KES ${b.amountKes}' : ''}${b.accountRef != null ? ' · Ref ${b.accountRef}' : ''}',
      icon: _categoryIcon(b.category),
      trailing: _paying
          ? const EsokoSkeleton(width: 64, height: 14)
          : EsokoButton.tertiary(label: 'Mark paid', onPressed: _markPaid),
      onTap: b.isFunding
          ? () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => BillFundingScreen(billId: b.id),
                ),
              )
          : null,
    );
    if (!b.isFunding) return tile;
    // A funded bill gets its progress fill directly under the tile —
    // the "gamified" half of this screen: a friend/family chip-in
    // moves this bar, not just a self-reported "mark paid" tap.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        tile,
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(EsokoRadius.pill),
            child: LinearProgressIndicator(
              value: b.fundingProgress,
              minHeight: 6,
              backgroundColor:
                  Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
            ),
          ),
        ),
      ],
    );
  }
}
