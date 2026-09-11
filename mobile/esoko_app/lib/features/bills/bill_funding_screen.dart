import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'bill_models.dart';
import 'bills_repository.dart';

final billFundingProvider = FutureProvider.autoDispose
    .family<BillFundingSummary, String>(
      (ref, billId) => ref.watch(billsRepositoryProvider).funding(billId),
    );

final billContributionsProvider = FutureProvider.autoDispose
    .family<List<BillContributionRow>, String>(
      (ref, billId) => ref.watch(billsRepositoryProvider).contributions(billId),
    );

/// A bill's own funding page — guest-safe (see dbx.GetBillFundingSummary),
/// so this is the screen a shared link opens for family/friends without
/// an Esoko account, same as the owner sees it. "Chip in" is the one
/// action here; everything else about the bill (accountRef, owner) is
/// deliberately absent, per the PII-minimal rule.
class BillFundingScreen extends ConsumerWidget {
  const BillFundingScreen({super.key, required this.billId});
  final String billId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(billFundingProvider(billId));
    final contributions = ref.watch(billContributionsProvider(billId));

    Future<void> refreshAll() async {
      ref.invalidate(billFundingProvider(billId));
      ref.invalidate(billContributionsProvider(billId));
    }

    return Scaffold(
      appBar: const EsokoAppBar(title: 'Help fund this bill'),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: refreshAll,
          child: EsokoAsyncView(
            value: summary,
            onRetry: () => ref.invalidate(billFundingProvider(billId)),
            data: (context, s) => Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: ListView(
                  padding: const EdgeInsets.all(EsokoSpacing.s5),
                  children: [
                    Text(s.label, style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: EsokoSpacing.s1),
                    Text(
                      s.funded ? 'Fully funded' : 'KES ${s.raisedKes} of KES ${s.targetKes}',
                      style: TextStyle(color: Theme.of(context).textTheme.bodySmall?.color),
                    ),
                    const SizedBox(height: EsokoSpacing.s3),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(EsokoRadius.pill),
                      child: LinearProgressIndicator(
                        value: s.progress,
                        minHeight: 10,
                        backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
                      ),
                    ),
                    const SizedBox(height: EsokoSpacing.s2),
                    Text(
                      '${s.contributorsCount} contributor${s.contributorsCount == 1 ? '' : 's'}',
                      style: TextStyle(color: Theme.of(context).textTheme.bodySmall?.color, fontSize: 12),
                    ),
                    const SizedBox(height: EsokoSpacing.s5),
                    if (!s.funded)
                      EsokoLoadingButton(
                        label: 'Chip in',
                        loading: false,
                        onPressed: () async {
                          final done = await Navigator.of(context).push<bool>(
                            MaterialPageRoute(builder: (_) => _ContributeScreen(billId: billId)),
                          );
                          if (done == true) refreshAll();
                        },
                      ),
                    const SizedBox(height: EsokoSpacing.s6),
                    EsokoSubHeader('Who\'s chipped in'),
                    const SizedBox(height: EsokoSpacing.s2),
                    contributions.when(
                      data: (list) => list.isEmpty
                          ? const EsokoEmptyState(
                              icon: Icons.volunteer_activism_outlined,
                              message: 'No contributions yet — be the first.',
                            )
                          : Column(
                              children: [
                                for (final c in list)
                                  EsokoListTile(
                                    title: c.contributorName,
                                    subtitle: 'KES ${c.amountKes}',
                                    icon: Icons.favorite_outline,
                                  ),
                              ],
                            ),
                      loading: () => const EsokoSkeletonCard(leading: false),
                      error: (_, _) => const SizedBox.shrink(),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ContributeScreen extends ConsumerStatefulWidget {
  const _ContributeScreen({required this.billId});
  final String billId;

  @override
  ConsumerState<_ContributeScreen> createState() => _ContributeScreenState();
}

class _ContributeScreenState extends ConsumerState<_ContributeScreen> {
  final _nameController = TextEditingController();
  final _msisdnController = TextEditingController();
  final _amountController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _msisdnController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (_nameController.text.trim().isEmpty ||
        _msisdnController.text.trim().isEmpty ||
        amount == null ||
        amount <= 0) {
      setState(() => _error = 'Enter your name, M-Pesa number, and an amount.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(billsRepositoryProvider).contribute(
            billId: widget.billId,
            contributorName: _nameController.text.trim(),
            contributorMsisdn: _msisdnController.text.trim(),
            amountKes: amount,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Chip in'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  EsokoFormField(
                    controller: _nameController,
                    label: 'Your name',
                    icon: Icons.person_outline,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormField(
                    controller: _msisdnController,
                    label: 'M-Pesa number',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormField(
                    controller: _amountController,
                    label: 'Amount (KES)',
                    icon: Icons.payments_outlined,
                    keyboardType: TextInputType.number,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s3),
                    EsokoFormError(message: _error!),
                  ],
                  const SizedBox(height: EsokoSpacing.s4),
                  EsokoLoadingButton(
                    label: 'Pay with M-Pesa',
                    loading: _busy,
                    onPressed: _send,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
