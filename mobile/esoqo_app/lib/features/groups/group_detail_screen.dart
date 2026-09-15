import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
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

    final groupName = group.valueOrNull?.displayName;
    return Scaffold(
      appBar: EsoqoAppBar(
        title: groupName ?? 'Group',
        titleWidget: groupName == null
            ? null
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Same tag as the avatar on MyGroupsScreen's list
                  // tile — it grows into the app bar on push, shrinks
                  // back on pop.
                  Hero(
                    tag: 'group-hero-$groupId',
                    child: CircleAvatar(
                      radius: 14,
                      backgroundColor: Theme.of(context)
                          .colorScheme
                          .primaryContainer,
                      child: Text(
                        groupName.isEmpty
                            ? '?'
                            : groupName.substring(0, 1).toUpperCase(),
                        style: TextStyle(
                          fontSize: EsoqoTypeScale.labelSmall,
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: EsoqoSpacing.s2),
                  Expanded(
                    child: Text(groupName, overflow: TextOverflow.ellipsis),
                  ),
                ],
              ),
      ),
      body: RefreshIndicator(
        onRefresh: () async => _refreshAll(ref),
        child: EsoqoAsyncView(
          value: group,
          onRetry: () => ref.invalidate(groupDetailProvider(groupId)),
          data: (context, g) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView(
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                children: [
                  EsoqoAmountHeader(
                    label: 'Group balance',
                    trailing: balance.when(
                      data: (b) =>
                          EsoqoAmountText(b.toStringAsFixed(2), fontSize: EsoqoTypeScale.pageTitle),
                      loading: () => const SizedBox(
                        width: 96,
                        height: 28,
                        child: EsoqoSkeleton(radius: EsoqoRadius.sm),
                      ),
                      error: (e, _) =>
                          const EsoqoFormError(message: 'Balance unavailable'),
                    ),
                  ),
                  const SizedBox(height: EsoqoSpacing.s4),
                  Row(
                    children: [
                      Expanded(
                        child: EsoqoButton.primary(
                          label: 'Contribute',
                          esoqoIcon: EsoqoIconName.coins,
                          onPressed: () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    ContributeScreen(groupId: groupId),
                              ),
                            );
                            _refreshAll(ref);
                          },
                        ),
                      ),
                      if (isOfficer) ...[
                        const SizedBox(width: EsoqoSpacing.s3),
                        Expanded(
                          child: EsoqoButton.secondary(
                            label: 'Withdraw',
                            esoqoIcon: EsoqoIconName.send,
                            onPressed: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) =>
                                      RequestWithdrawalScreen(groupId: groupId),
                                ),
                              );
                              _refreshAll(ref);
                            },
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: EsoqoSpacing.s6),
                  const EsoqoSubHeader('Timeline'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  EsoqoAsyncView(
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
                          EsoqoStagger(
                            index: i,
                            child: _TimelineTile(entry: list[i]),
                          ),
                      ],
                    ),
                  ),

                  const SizedBox(height: EsoqoSpacing.s6),
                  const EsoqoSubHeader('Members'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  for (var m = 0; m < g.members.length; m++)
                    EsoqoStagger(
                      index: m,
                      child: _MemberTile(member: g.members[m]),
                    ),

                  const SizedBox(height: EsoqoSpacing.s6),
                  const EsoqoSubHeader('Withdrawals'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  EsoqoAsyncView(
                    value: withdrawals,
                    isEmpty: (list) => list.isEmpty,
                    emptyMessage: 'No withdrawals yet.',
                    emptyIcon: Icons.outbox_outlined,
                    emptyEsoqoIcon: EsoqoIconName.send,
                    onRetry: () =>
                        ref.invalidate(groupWithdrawalsProvider(groupId)),
                    data: (context, list) => Column(
                      children: [
                        for (var i = 0; i < list.length; i++)
                          EsoqoStagger(
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

                  const SizedBox(height: EsoqoSpacing.s6),
                  const EsoqoSubHeader('Contribution history'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  EsoqoAsyncView(
                    value: contributions,
                    isEmpty: (list) => list.isEmpty,
                    emptyMessage: 'No contributions yet.',
                    emptyIcon: Icons.savings_outlined,
                    emptyEsoqoIcon: EsoqoIconName.coins,
                    onRetry: () =>
                        ref.invalidate(groupContributionsProvider(groupId)),
                    data: (context, list) => Column(
                      children: [
                        for (var i = 0; i < list.length; i++)
                          EsoqoStagger(
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
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
      child: EsoqoListTile(
        title: member.name,
        subtitle: member.roleLabel,
        esoqoIcon: member.isOfficer ? EsoqoIconName.shield : EsoqoIconName.user,
        trailing: member.status == 'PENDING'
            ? const EsoqoStatusPill(
                label: 'Pending',
                color: EsoqoColors.amber,
                esoqoIcon: EsoqoIconName.clock,
              )
            : null,
      ),
    );
  }
}

/// A withdrawal is a multi-signer trust chain (see request_withdrawal_
/// screen.dart) — "2/3 signed" buried in a subtitle string was the whole
/// signal for how close a payout is to actually happening. This makes
/// that quorum a first-class visual (a filled bar, not just a fraction)
/// so a member or officer can tell "waiting on one more signature" apart
/// from "just broadcast" at a glance, not by parsing text.
class _WithdrawalTile extends StatelessWidget {
  const _WithdrawalTile({required this.withdrawal, required this.onTap});
  final WithdrawalRow withdrawal;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Pulled from the theme, not hardcoded: this tile sits on EsoqoCard's
    // surface, which is white in light mode and darkSurface2 in dark —
    // a fixed EsoqoColors.text2 (tuned for the light one) loses contrast
    // against the dark one. bodySmall's colour is Material3-derived per
    // brightness, so it stays legible on either.
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final (statusColor, statusIcon) = switch (withdrawal.status) {
      'EXECUTED' => (scheme.primary, EsoqoIconName.checkCircle),
      'REJECTED' || 'EXPIRED' => (scheme.error, EsoqoIconName.ban),
      _ => (EsoqoColors.amber, EsoqoIconName.clock),
    };
    final quorumDone = withdrawal.requiredSigners == 0
        ? 1.0
        : (withdrawal.approveCount / withdrawal.requiredSigners).clamp(
            0.0,
            1.0,
          );
    return Padding(
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
      child: EsoqoCard(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: scheme.primaryContainer,
                  child: EsoqoIcon(
                    EsoqoIconName.send,
                    color: statusColor,
                    size: 18,
                  ),
                ),
                const SizedBox(width: EsoqoSpacing.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      EsoqoAmountText(withdrawal.amountKes, fontSize: EsoqoTypeScale.subTitle),
                      Text(
                        withdrawal.purpose,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                EsoqoStatusPill(
                  label: withdrawal.status,
                  color: statusColor,
                  esoqoIcon: statusIcon,
                ),
              ],
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(EsoqoRadius.pill),
                    child: LinearProgressIndicator(
                      value: quorumDone,
                      minHeight: 6,
                      backgroundColor: EsoqoColors.line,
                      valueColor: AlwaysStoppedAnimation(statusColor),
                    ),
                  ),
                ),
                const SizedBox(width: EsoqoSpacing.s2),
                Text(
                  '${withdrawal.approveCount}/${withdrawal.requiredSigners} signed',
                  style: TextStyle(
                    color: muted,
                    fontSize: EsoqoTypeScale.micro,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
        ),
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
      'posted' => (scheme.primary, EsoqoIconName.checkCircle),
      'rejected' => (scheme.error, EsoqoIconName.ban),
      'requested' => (EsoqoColors.amber, EsoqoIconName.clock),
      _ => (Theme.of(context).textTheme.bodySmall?.color ?? scheme.outline, EsoqoIconName.info),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
      child: EsoqoListTile(
        title: entry.line,
        subtitle: entry.occurredAt,
        esoqoIcon: icon,
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
    final confirmed = contribution.status == 'CONFIRMED';
    final statusColor = confirmed ? EsoqoColors.green : EsoqoColors.amber;
    return Padding(
      padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
      child: EsoqoListTile(
        title:
            '${contribution.contributorName} · KES ${contribution.amountKes}',
        subtitle: confirmed
            ? 'Confirmed by an officer'
            : 'Awaiting officer confirmation',
        esoqoIcon: EsoqoIconName.coins,
        trailing: EsoqoStatusPill(
          label: confirmed ? 'Confirmed' : 'Pending',
          color: statusColor,
          esoqoIcon: confirmed
              ? EsoqoIconName.checkCircle
              : EsoqoIconName.clock,
        ),
      ),
    );
  }
}
