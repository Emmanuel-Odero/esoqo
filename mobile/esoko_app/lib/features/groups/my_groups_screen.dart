import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'create_group_screen.dart';
import 'group_detail_screen.dart';
import 'group_models.dart';
import 'join_group_screen.dart';

final myGroupsProvider = FutureProvider.autoDispose<List<GroupSummary>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/me/groups');
  final list = (res['groups'] as List?) ?? const [];
  return list.map((e) => GroupSummary.fromJson(e as Map<String, dynamic>)).toList();
});

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
        child: groups.when(
          data: (list) => CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your groups', style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: EsokoSpacing.s1),
                      Text('Chamas, table banking and welfare groups you belong to.', style: TextStyle(color: EsokoColors.text2)),
                      const SizedBox(height: EsokoSpacing.s4),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const JoinGroupScreen())),
                              icon: const Icon(Icons.search, size: 18),
                              label: const Text('Join a group'),
                            ),
                          ),
                          const SizedBox(width: EsokoSpacing.s3),
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateGroupScreen())),
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
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(EsokoSpacing.s8),
                    child: Column(
                      children: [
                        Icon(Icons.groups_outlined, size: 40, color: EsokoColors.text3),
                        const SizedBox(height: EsokoSpacing.s3),
                        Text('No groups yet — start or join one above.', style: TextStyle(color: EsokoColors.text2)),
                      ],
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(EsokoSpacing.s4, EsokoSpacing.s2, EsokoSpacing.s4, EsokoSpacing.s6),
                  sliver: SliverList.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                    itemBuilder: (context, i) {
                      final g = list[i];
                      return Card(
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: EsokoColors.greenTint,
                            child: Text(g.displayName.substring(0, 1), style: TextStyle(color: EsokoColors.green)),
                          ),
                          title: Text(g.displayName),
                          subtitle: Text('${_titleCase(g.kind)} · ${g.memberCount} member${g.memberCount == 1 ? '' : 's'}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => GroupDetailScreen(groupId: g.id))),
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Text(
              e is ApiException ? e.message : 'Could not load your groups.',
              style: TextStyle(color: EsokoColors.red),
            ),
          ),
        ),
      ),
    );
  }
}

String _titleCase(String s) => s.split('_').map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}').join(' ');
