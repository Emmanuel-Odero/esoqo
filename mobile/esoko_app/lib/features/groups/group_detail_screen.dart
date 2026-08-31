import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'contribute_screen.dart';
import 'group_models.dart';
import 'request_withdrawal_screen.dart';
import 'withdrawal_detail_screen.dart';

final groupDetailProvider = FutureProvider.autoDispose.family<GroupDetail, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/groups/$id');
  return GroupDetail.fromJson(res);
});

final groupBalanceProvider = FutureProvider.autoDispose.family<double, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/groups/$id/balance');
  return (res['balanceKes'] as num?)?.toDouble() ?? 0;
});

final groupContributionsProvider = FutureProvider.autoDispose.family<List<ContributionRow>, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/groups/$id/contributions');
  final list = (res['contributions'] as List?) ?? const [];
  return list.map((e) => ContributionRow.fromJson(e as Map<String, dynamic>)).toList();
});

final groupWithdrawalsProvider = FutureProvider.autoDispose.family<List<WithdrawalRow>, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/groups/$id/withdrawals');
  final list = (res['withdrawals'] as List?) ?? const [];
  return list.map((e) => WithdrawalRow.fromJson(e as Map<String, dynamic>)).toList();
});

class GroupDetailScreen extends ConsumerWidget {
  const GroupDetailScreen({super.key, required this.groupId});
  final String groupId;

  void _refreshAll(WidgetRef ref) {
    ref.invalidate(groupDetailProvider(groupId));
    ref.invalidate(groupBalanceProvider(groupId));
    ref.invalidate(groupContributionsProvider(groupId));
    ref.invalidate(groupWithdrawalsProvider(groupId));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(groupDetailProvider(groupId));
    final balance = ref.watch(groupBalanceProvider(groupId));
    final contributions = ref.watch(groupContributionsProvider(groupId));
    final withdrawals = ref.watch(groupWithdrawalsProvider(groupId));
    final auth = ref.watch(authControllerProvider);
    final myPartyId = auth is AuthSignedIn ? auth.profile.partyId : null;

    final isOfficer = group.valueOrNull?.members
            .where((m) => m.personId == myPartyId)
            .any((m) => m.isOfficer) ??
        false;

    return Scaffold(
      appBar: AppBar(title: Text(group.valueOrNull?.displayName ?? 'Group')),
      body: RefreshIndicator(
        onRefresh: () async => _refreshAll(ref),
        child: EsokoAsyncView(
          value: group,
          onRetry: () => ref.invalidate(groupDetailProvider(groupId)),
          data: (context, g) => ListView(
            padding: const EdgeInsets.all(EsokoSpacing.s4),
            children: [
              Container(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                decoration: BoxDecoration(color: EsokoColors.greenTint, borderRadius: BorderRadius.circular(EsokoRadius.lg)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Group balance', style: TextStyle(color: EsokoColors.text2, fontSize: 12)),
                    const SizedBox(height: 4),
                    balance.when(
                      data: (b) => Text('KES ${b.toStringAsFixed(2)}', style: TextStyle(color: EsokoColors.green, fontSize: 26, fontWeight: FontWeight.bold)),
                      loading: () => const SizedBox(height: 32, child: LinearProgressIndicator()),
                      error: (e, _) => Text('—', style: TextStyle(color: EsokoColors.red)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s4),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () async {
                        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ContributeScreen(groupId: groupId)));
                        _refreshAll(ref);
                      },
                      icon: const Icon(Icons.add_card_outlined, size: 18),
                      label: const Text('Contribute'),
                    ),
                  ),
                  if (isOfficer) ...[
                    const SizedBox(width: EsokoSpacing.s3),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RequestWithdrawalScreen(groupId: groupId)));
                          _refreshAll(ref);
                        },
                        icon: const Icon(Icons.outbox_outlined, size: 18),
                        label: const Text('Withdraw'),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: EsokoSpacing.s6),
              Text('Members', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: EsokoSpacing.s2),
              for (final m in g.members) _MemberTile(member: m),

              const SizedBox(height: EsokoSpacing.s6),
              Text('Withdrawals', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: EsokoSpacing.s2),
              withdrawals.when(
                data: (list) => list.isEmpty
                    ? const EsokoEmptyState(icon: Icons.outbox_outlined, message: 'No withdrawals yet.')
                    : Column(children: [
                        for (final w in list)
                          _WithdrawalTile(
                            withdrawal: w,
                            onTap: () async {
                              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WithdrawalDetailScreen(withdrawalId: w.id)));
                              _refreshAll(ref);
                            },
                          ),
                      ]),
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => const SizedBox.shrink(),
              ),

              const SizedBox(height: EsokoSpacing.s6),
              Text('Contribution history', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: EsokoSpacing.s2),
              contributions.when(
                data: (list) => list.isEmpty
                    ? const EsokoEmptyState(icon: Icons.savings_outlined, message: 'No contributions yet.')
                    : Column(children: [for (final c in list) _ContributionTile(contribution: c)]),
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  const _MemberTile({required this.member});
  final MemberRow member;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: member.isOfficer ? EsokoColors.blueTint : EsokoColors.paper,
          child: Icon(member.isOfficer ? Icons.shield_outlined : Icons.person_outline, size: 18, color: member.isOfficer ? EsokoColors.blue : EsokoColors.text3),
        ),
        title: Text(member.name),
        subtitle: Text(member.roleLabel),
        trailing: member.status == 'PENDING'
            ? Chip(label: const Text('Pending', style: TextStyle(fontSize: 10)), backgroundColor: EsokoColors.amberTint)
            : null,
      ),
    );
  }
}

class _WithdrawalTile extends StatelessWidget {
  const _WithdrawalTile({required this.withdrawal, required this.onTap});
  final WithdrawalRow withdrawal;
  final VoidCallback onTap;

  Color _statusColor() => switch (withdrawal.status) {
        'EXECUTED' => EsokoColors.green,
        'REJECTED' || 'EXPIRED' => EsokoColors.red,
        _ => EsokoColors.amber,
      };

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: ListTile(
        leading: Icon(Icons.outbox_outlined, color: _statusColor()),
        title: Text('KES ${withdrawal.amountKes} — ${withdrawal.purpose}'),
        subtitle: Text('${withdrawal.approveCount}/${withdrawal.requiredSigners} signed · ${withdrawal.status}'),
        onTap: onTap,
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

class _ContributionTile extends StatelessWidget {
  const _ContributionTile({required this.contribution});
  final ContributionRow contribution;

  @override
  Widget build(BuildContext context) {
    final confirmed = contribution.status == 'CONFIRMED';
    return Card(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: ListTile(
        leading: Icon(Icons.savings_outlined, color: confirmed ? EsokoColors.green : EsokoColors.text3),
        title: Text('KES ${contribution.amountKes} — ${contribution.contributorName}'),
        subtitle: Text(contribution.status),
      ),
    );
  }
}
