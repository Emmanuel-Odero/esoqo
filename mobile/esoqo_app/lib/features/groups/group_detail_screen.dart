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

    final groupName = group.valueOrNull?.displayName;
    return Scaffold(
      appBar: EsokoAppBar(
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
                          fontSize: 12,
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: EsokoSpacing.s2),
                  Expanded(
                    child: Text(groupName, overflow: TextOverflow.ellipsis),
                  ),
                ],
              ),
      ),
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
                        child: EsokoButton.primary(
                          label: 'Contribute',
                          esokoIcon: EsokoIconName.coins,
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
                        const SizedBox(width: EsokoSpacing.s3),
                        Expanded(
                          child: EsokoButton.secondary(
                            label: 'Withdraw',
                            esokoIcon: EsokoIconName.send,
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
                    emptyEsokoIcon: EsokoIconName.send,
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
                    emptyEsokoIcon: EsokoIconName.coins,
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
        esokoIcon: member.isOfficer ? EsokoIconName.shield : EsokoIconName.user,
        trailing: member.status == 'PENDING'
            ? const EsokoStatusPill(
                label: 'Pending',
                color: EsokoColors.amber,
                esokoIcon: EsokoIconName.clock,
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
    // Pulled from the theme, not hardcoded: this tile sits on EsokoCard's
    // surface, which is white in light mode and darkSurface2 in dark —
    // a fixed EsokoColors.text2 (tuned for the light one) loses contrast
    // against the dark one. bodySmall's colour is Material3-derived per
    // brightness, so it stays legible on either.
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final (statusColor, statusIcon) = switch (withdrawal.status) {
      'EXECUTED' => (scheme.primary, EsokoIconName.checkCircle),
      'REJECTED' || 'EXPIRED' => (scheme.error, EsokoIconName.ban),
      _ => (EsokoColors.amber, EsokoIconName.clock),
    };
    final quorumDone = withdrawal.requiredSigners == 0
        ? 1.0
        : (withdrawal.approveCount / withdrawal.requiredSigners).clamp(
            0.0,
            1.0,
          );
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoCard(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: scheme.primaryContainer,
                  child: EsokoIcon(
                    EsokoIconName.send,
                    color: statusColor,
                    size: 18,
                  ),
                ),
                const SizedBox(width: EsokoSpacing.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      EsokoAmountText(withdrawal.amountKes, fontSize: 15),
                      Text(
                        withdrawal.purpose,
                        style: TextStyle(color: muted, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
                EsokoStatusPill(
                  label: withdrawal.status,
                  color: statusColor,
                  esokoIcon: statusIcon,
                ),
              ],
            ),
            const SizedBox(height: EsokoSpacing.s3),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(EsokoRadius.pill),
                    child: LinearProgressIndicator(
                      value: quorumDone,
                      minHeight: 6,
                      backgroundColor: EsokoColors.line,
                      valueColor: AlwaysStoppedAnimation(statusColor),
                    ),
                  ),
                ),
                const SizedBox(width: EsokoSpacing.s2),
                Text(
                  '${withdrawal.approveCount}/${withdrawal.requiredSigners} signed',
                  style: TextStyle(
                    color: muted,
                    fontSize: 11.5,
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
    final confirmed = contribution.status == 'CONFIRMED';
    final statusColor = confirmed ? EsokoColors.green : EsokoColors.amber;
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title:
            '${contribution.contributorName} · KES ${contribution.amountKes}',
        subtitle: confirmed
            ? 'Confirmed by an officer'
            : 'Awaiting officer confirmation',
        esokoIcon: EsokoIconName.coins,
        trailing: EsokoStatusPill(
          label: confirmed ? 'Confirmed' : 'Pending',
          color: statusColor,
          esokoIcon: confirmed
              ? EsokoIconName.checkCircle
              : EsokoIconName.clock,
        ),
      ),
    );
  }
}
