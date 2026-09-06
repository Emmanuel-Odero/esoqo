import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoko_tokens.dart';
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
        child: EsokoAsyncView(
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
                        EsokoSpacing.s5,
                        EsokoSpacing.s5,
                        EsokoSpacing.s5,
                        EsokoSpacing.s2,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          EsokoPageLead(
                            'Chamas, table banking and welfare groups you belong to.',
                          ),
                          const SizedBox(height: EsokoSpacing.s4),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const JoinGroupScreen(),
                                    ),
                                  ),
                                  icon: const Icon(Icons.search, size: 18),
                                  label: const Text('Join a group'),
                                ),
                              ),
                              const SizedBox(width: EsokoSpacing.s3),
                              Expanded(
                                child: FilledButton.icon(
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const CreateGroupScreen(),
                                    ),
                                  ),
                                  icon: const Icon(Icons.add, size: 18),
                                  label: const Text('Start a group'),
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
                      child: EsokoEmptyState(
                        icon: Icons.groups_outlined,
                        message: 'No groups yet — start or join one above.',
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(
                        EsokoSpacing.s4,
                        EsokoSpacing.s2,
                        EsokoSpacing.s4,
                        EsokoSpacing.s6,
                      ),
                      sliver: SliverList.separated(
                        itemCount: list.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: EsokoSpacing.s3),
                        itemBuilder: (context, i) {
                          final g = list[i];
                          return EsokoStagger(
                            index: i,
                            child: EsokoListTile(
                              title: g.displayName,
                              subtitle:
                                  '${_titleCase(g.kind)} · ${g.memberCount} member${g.memberCount == 1 ? '' : 's'}',
                              initial: g.displayName,
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

String _titleCase(String s) => s
    .split('_')
    .map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}')
    .join(' ');
