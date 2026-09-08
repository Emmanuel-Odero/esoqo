import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'contribute_screen.dart';
import 'group_models.dart';
import 'groups_repository.dart';
import 'request_withdrawal_screen.dart';
import 'withdrawal_detail_screen.dart';

final groupDetailProvider = FutureProvider.autoDispose
    .family<GroupDetail, String>(
      (ref, id) => ref.watch(groupsRepositoryProvider).group(id),
    );

final groupBalanceProvider = FutureProvider.autoDispose.family<double, String>(
  (ref, id) => ref.watch(groupsRepositoryProvider).groupBalance(id),
);

final groupContributionsProvider = FutureProvider.autoDispose
    .family<List<ContributionRow>, String>(
      (ref, id) => ref.watch(groupsRepositoryProvider).contributions(id),
    );

final groupWithdrawalsProvider = FutureProvider.autoDispose
    .family<List<WithdrawalRow>, String>(
      (ref, id) => ref.watch(groupsRepositoryProvider).withdrawals(id),
    );

final groupTimelineProvider = FutureProvider.autoDispose
    .family<List<TimelineEntry>, String>(
      (ref, id) => ref.watch(groupsRepositoryProvider).timeline(id),
    );

class GroupDetailScreen extends ConsumerWidget {
  const GroupDetailScreen({super.key, required this.groupId});
  final String groupId;

  void _refreshAll(WidgetRef ref) {
    ref.invalidate(groupDetailProvider(groupId));
    ref.invalidate(groupBalanceProvider(groupId));
    ref.invalidate(groupContributionsProvider(groupId));
    ref.invalidate(groupWithdrawalsProvider(groupId));
    ref.invalidate(groupTimelineProvider(groupId));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final group = ref.watch(groupDetailProvider(groupId));
    final balance = ref.watch(groupBalanceProvider(groupId));
    final contributions = ref.watch(groupContributionsProvider(groupId));
    final withdrawals = ref.watch(groupWithdrawalsProvider(groupId));
    final timeline = ref.watch(groupTimelineProvider(groupId));
    final auth = ref.watch(authControllerProvider);
    final myPartyId = auth is AuthSignedIn ? auth.profile.partyId : null;

    final isOfficer =
        group.valueOrNull?.members
            .where((m) => m.personId == myPartyId)
            .any((m) => m.isOfficer) ??
        false;

    return Scaffold(
      appBar: EsokoAppBar(title: group.valueOrNull?.displayName ?? 'Group'),
      body: RefreshIndicator(
        onRefresh: () async => _refreshAll(ref),
        child: EsokoAsyncView(
          value: group,
          onRetry: () => ref.invalidate(groupDetailProvider(groupId)),
          data: (context, g) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                children: [
                  EsokoAmountHeader(
                    label: 'Group balance',
                    trailing: balance.when(
                      data: (b) =>
                          EsokoAmountText(b.toStringAsFixed(2), fontSize: 26),
                      loading: () => const SizedBox(
                        width: 96,
                        height: 28,
                        child: EsokoSkeleton(radius: EsokoRadius.sm),
                      ),
                      error: (e, _) =>
                          const EsokoFormError(message: 'Balance unavailable'),
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    ContributeScreen(groupId: groupId),
                              ),
                            );
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
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) =>
                                      RequestWithdrawalScreen(groupId: groupId),
                                ),
                              );
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
                  const EsokoSubHeader('Timeline'),
                  const SizedBox(height: EsokoSpacing.s2),
                  EsokoAsyncView(
                    value: timeline,
                    isEmpty: (list) => list.isEmpty,
                    emptyMessage:
                        'Nothing yet — contributions and withdrawals show up here as they happen.',
                    emptyIcon: Icons.history_outlined,
                    onRetry: () =>
                        ref.invalidate(groupTimelineProvider(groupId)),
                    data: (context, list) => Column(
                      children: [
                        for (var i = 0; i < list.length; i++)
                          EsokoStagger(
                            index: i,
                            child: _TimelineTile(entry: list[i]),
                          ),
                      ],
                    ),
                  ),

                  const SizedBox(height: EsokoSpacing.s6),
                  const EsokoSubHeader('Members'),
                  const SizedBox(height: EsokoSpacing.s2),
                  for (var m = 0; m < g.members.length; m++)
                    EsokoStagger(
                      index: m,
                      child: _MemberTile(member: g.members[m]),
                    ),

                  const SizedBox(height: EsokoSpacing.s6),
                  const EsokoSubHeader('Withdrawals'),
                  const SizedBox(height: EsokoSpacing.s2),
                  EsokoAsyncView(
                    value: withdrawals,
                    isEmpty: (list) => list.isEmpty,
                    emptyMessage: 'No withdrawals yet.',
                    emptyIcon: Icons.outbox_outlined,
                    onRetry: () =>
                        ref.invalidate(groupWithdrawalsProvider(groupId)),
                    data: (context, list) => Column(
                      children: [
                        for (var i = 0; i < list.length; i++)
                          EsokoStagger(
                            index: i,
                            child: _WithdrawalTile(
                              withdrawal: list[i],
                              onTap: () async {
                                await Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => WithdrawalDetailScreen(
                                      withdrawalId: list[i].id,
                                    ),
                                  ),
                                );
                                _refreshAll(ref);
                              },
                            ),
                          ),
                      ],
                    ),
                  ),

                  const SizedBox(height: EsokoSpacing.s6),
                  const EsokoSubHeader('Contribution history'),
                  const SizedBox(height: EsokoSpacing.s2),
                  EsokoAsyncView(
                    value: contributions,
                    isEmpty: (list) => list.isEmpty,
                    emptyMessage: 'No contributions yet.',
                    emptyIcon: Icons.savings_outlined,
                    onRetry: () =>
                        ref.invalidate(groupContributionsProvider(groupId)),
                    data: (context, list) => Column(
                      children: [
                        for (var i = 0; i < list.length; i++)
                          EsokoStagger(
                            index: i,
                            child: _ContributionTile(contribution: list[i]),
                          ),
                      ],
                    ),
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

class _MemberTile extends StatelessWidget {
  const _MemberTile({required this.member});
  final MemberRow member;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: member.name,
        subtitle: member.roleLabel,
        icon: member.isOfficer ? Icons.shield_outlined : Icons.person_outline,
        trailing: member.status == 'PENDING'
            ? const Chip(label: Text('Pending', style: TextStyle(fontSize: 10)))
            : null,
      ),
    );
  }
}

class _WithdrawalTile extends StatelessWidget {
  const _WithdrawalTile({required this.withdrawal, required this.onTap});
  final WithdrawalRow withdrawal;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final statusColor = switch (withdrawal.status) {
      'EXECUTED' => scheme.primary,
      'REJECTED' || 'EXPIRED' => scheme.error,
      _ => EsokoColors.amber,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: 'KES ${withdrawal.amountKes} — ${withdrawal.purpose}',
        subtitle:
            '${withdrawal.approveCount}/${withdrawal.requiredSigners} signed · ${withdrawal.status}',
        icon: Icons.outbox_outlined,
        iconColor: statusColor,
        onTap: onTap,
      ),
    );
  }
}

/// One row of the member-visible timeline — the direct antidote to
/// "the treasurer said it was fine": every member reads the same
/// tamper-evident feed, not a summary handed down at the next meeting.
/// Colour comes from [TimelineEntry.kind] (set by the Go formatter),
/// never guessed from the line's English text here.
class _TimelineTile extends StatelessWidget {
  const _TimelineTile({required this.entry});
  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (color, icon) = switch (entry.kind) {
      'posted' => (scheme.primary, EsokoIconName.checkCircle),
      'rejected' => (scheme.error, EsokoIconName.ban),
      'requested' => (EsokoColors.amber, EsokoIconName.clock),
      _ => (Theme.of(context).textTheme.bodySmall?.color ?? scheme.outline, EsokoIconName.info),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: entry.line,
        subtitle: entry.occurredAt,
        esokoIcon: icon,
        iconColor: color,
      ),
    );
  }
}

class _ContributionTile extends StatelessWidget {
  const _ContributionTile({required this.contribution});
  final ContributionRow contribution;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title:
            'KES ${contribution.amountKes} — ${contribution.contributorName}',
        subtitle: contribution.status,
        icon: Icons.savings_outlined,
      ),
    );
  }
}
