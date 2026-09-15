import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'group_models.dart';
import 'groups_repository.dart';

/// Search-then-join — GET /v1/groups/search then POST
/// /v1/groups/:id/join (core-go's new self-serve JoinGroup).
class JoinGroupScreen extends ConsumerStatefulWidget {
  const JoinGroupScreen({super.key});

  @override
  ConsumerState<JoinGroupScreen> createState() => _JoinGroupScreenState();
}

class _JoinGroupScreenState extends ConsumerState<JoinGroupScreen> {
  final _queryController = TextEditingController();
  List<GroupSummary> _results = [];
  bool _searching = false;
  String? _joiningId;
  String? _error;

  Future<void> _search(String q) async {
    if (q.trim().length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final results = await ref.read(groupsRepositoryProvider).searchGroups(q);
      if (mounted) setState(() => _results = results);
    } on ApiException {
      if (mounted) setState(() => _results = []);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _join(GroupSummary g) async {
    setState(() {
      _joiningId = g.id;
      _error = null;
    });
    try {
      await ref.read(groupsRepositoryProvider).joinGroup(g.id);
      if (mounted) Navigator.of(context).pop(g.id);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _joiningId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Join a group'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  EsoqoSearchField(
                    controller: _queryController,
                    label: 'Search by group name',
                    hint: 'Type to search groups',
                    debounce: const Duration(milliseconds: 350),
                    onChanged: _search,
                  ),
                  if (_error != null) EsoqoFormError(message: _error!),
                  const SizedBox(height: EsoqoSpacing.s4),
                  if (_searching)
                    const SizedBox(
                      height: EsoqoSpacing.s6,
                      child: EsoqoSkeletonList(count: 3),
                    ),
                  Expanded(
                    child: ListView.separated(
                      itemCount: _results.length,
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: EsoqoSpacing.s2),
                      itemBuilder: (context, i) {
                        final g = _results[i];
                        return EsoqoStagger(
                          index: i,
                          child: EsoqoListTile(
                            title: g.displayName,
                            subtitle: g.county,
                            trailing: _joiningId == g.id
                                ? const EsoqoSkeleton(width: 44, height: 14)
                                : EsoqoButton.tertiary(
                                    label: 'Join',
                                    onPressed: () => _join(g),
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
