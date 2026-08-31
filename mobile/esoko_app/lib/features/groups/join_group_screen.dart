import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'group_models.dart';

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
      final api = ref.read(apiClientProvider);
      final res = await api.get('/v1/groups/search?q=${Uri.encodeQueryComponent(q)}');
      final list = (res['groups'] as List?) ?? const [];
      setState(() => _results = list.map((e) => GroupSummary.fromJson(e as Map<String, dynamic>)).toList());
    } on ApiException {
      setState(() => _results = []);
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
      final api = ref.read(apiClientProvider);
      await api.post('/v1/groups/${g.id}/join');
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
      appBar: const EsokoAppBar(title: 'Join a group'),
      body: Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _queryController,
              decoration: const InputDecoration(labelText: 'Search by group name', prefixIcon: Icon(Icons.search)),
              onChanged: _search,
            ),
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s2),
              Text(_error!, style: TextStyle(color: EsokoColors.red)),
            ],
            const SizedBox(height: EsokoSpacing.s4),
            if (_searching) const Center(child: CircularProgressIndicator()),
            Expanded(
              child: ListView.separated(
                itemCount: _results.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
                itemBuilder: (context, i) {
                  final g = _results[i];
                  return Card(
                    child: ListTile(
                      title: Text(g.displayName),
                      subtitle: Text(g.county),
                      trailing: _joiningId == g.id
                          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : TextButton(onPressed: () => _join(g), child: const Text('Join')),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
