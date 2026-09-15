import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'create_group_screen.dart';
import 'group_detail_screen.dart';
import 'group_models.dart';
import 'groups_repository.dart';
import 'join_group_screen.dart';

final myGroupsProvider = FutureProvider.autoDispose<List<GroupSummary>>(
  (ref) => ref.watch(groupsRepositoryProvider).myGroups(),
);

/// Groups tab home — GET /v1/me/groups, with entry points to start a
/// new chama or join an existing one by name search.
class MyGroupsScreen extends ConsumerWidget {
  const MyGroupsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(myGroupsProvider);
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myGroupsProvider),
        child: EsoqoAsyncView(
          value: groups,
          onRetry: () => ref.invalidate(myGroupsProvider),
          data: (context, list) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(
                        EsoqoSpacing.s5,
                        EsoqoSpacing.s5,
                        EsoqoSpacing.s5,
                        EsoqoSpacing.s2,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          EsoqoPageLead(
                            'Chamas, table banking and welfare groups you belong to.',
                          ),
                          if (list.isNotEmpty) ...[
                            const SizedBox(height: EsoqoSpacing.s4),
                            _ChamaHero(groups: list),
                            for (final g in list.where(
                              (g) => g.pendingSignatures > 0,
                            )) ...[
                              const SizedBox(height: EsoqoSpacing.s3),
                              EsoqoAttentionCard(
                                when: g.pendingSignatures == 1
                                    ? 'Your signature is needed'
                                    : '${g.pendingSignatures} withdrawals need your signature',
                                title: g.displayName,
                                accent: EsoqoColors.amber,
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        GroupDetailScreen(groupId: g.id),
                                  ),
                                ),
                              ),
                            ],
                          ],
                          const SizedBox(height: EsoqoSpacing.s4),
                          Row(
                            children: [
                              Expanded(
                                child: EsoqoButton.secondary(
                                  label: 'Join a group',
                                  esoqoIcon: EsoqoIconName.search,
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const JoinGroupScreen(),
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: EsoqoSpacing.s3),
                              Expanded(
                                child: EsoqoButton.primary(
                                  label: 'Start a group',
                                  esoqoIcon: EsoqoIconName.plus,
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const CreateGroupScreen(),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (list.isEmpty)
                    const SliverToBoxAdapter(
                      child: EsoqoEmptyState(
                        esoqoIcon: EsoqoIconName.users,
                        message: 'No groups yet — start or join one above.',
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(
                        EsoqoSpacing.s4,
                        EsoqoSpacing.s2,
                        EsoqoSpacing.s4,
                        EsoqoSpacing.s6,
                      ),
                      sliver: SliverList.separated(
                        itemCount: list.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: EsoqoSpacing.s3),
                        itemBuilder: (context, i) {
                          final g = list[i];
                          return EsoqoStagger(
                            index: i,
                            child: EsoqoListTile(
                              title: g.displayName,
                              subtitle:
                                  '${_titleCase(g.kind)} · ${g.memberCount} member${g.memberCount == 1 ? '' : 's'}',
                              // Hero'd so the initial-avatar carries over
                              // into GroupDetailScreen's app bar — same
                              // contract as listing-hero/store-hero.
                              leading: Hero(
                                tag: 'group-hero-${g.id}',
                                child: CircleAvatar(
                                  backgroundColor: Theme.of(context)
                                      .colorScheme
                                      .primaryContainer,
                                  child: Text(
                                    g.displayName.isEmpty
                                        ? '?'
                                        : g.displayName
                                              .substring(0, 1)
                                              .toUpperCase(),
                                    style: TextStyle(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .primary,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ),
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) =>
                                      GroupDetailScreen(groupId: g.id),
                                ),
                              ),
                            ),
                          );
                        },
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

/// Total savings across every chama this person belongs to — the
/// figure the reorganisation proposal wanted leading this screen,
/// blocked until dbx.ListMyGroups carried balance/pendingSignatures
/// inline (see that function's own comment on the N+1 this avoids).
/// Navy, per SCREEN_CONVENTIONS.md Rule 3: this is money that belongs
/// to groups the person is *in*, stated as a fact, not an institution
/// acting on them.
class _ChamaHero extends StatelessWidget {
  const _ChamaHero({required this.groups});
  final List<GroupSummary> groups;

  @override
  Widget build(BuildContext context) {
    final total = Money.sum(
      groups.map((g) => Money.fromJson(g.balanceKes) ?? Money.zero),
    );
    return EsoqoCard(
      color: EsoqoColors.navy,
      padding: const EdgeInsets.all(EsoqoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Across your groups',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontSize: EsoqoTypeScale.meta,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: EsoqoSpacing.s1),
          Text(
            'KES ${total.format()}',
            style: EsoqoTypography.mono(
              fontSize: EsoqoTypeScale.hero,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          Text(
            '${groups.length} ${groups.length == 1 ? 'group' : 'groups'}',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontSize: EsoqoTypeScale.meta,
            ),
          ),
        ],
      ),
    );
  }
}

String _titleCase(String s) => s
    .split('_')
    .map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}')
    .join(' ');
