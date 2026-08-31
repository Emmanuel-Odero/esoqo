import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

const _groupKinds = [
  ('CHAMA', 'Chama'),
  ('SELF_HELP_GROUP', 'Self-help group'),
  ('TABLE_BANKING', 'Table banking'),
  ('WELFARE_GROUP', 'Welfare group'),
  ('CBO', 'Community-based organisation'),
  ('SACCO', 'SACCO'),
  ('OTHER', 'Other'),
];

/// POST /v1/groups — founds a new group with the signed-in person as
/// CHAIRPERSON (see core-go's CreateOwnGroup).
class CreateGroupScreen extends ConsumerStatefulWidget {
  const CreateGroupScreen({super.key});

  @override
  ConsumerState<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends ConsumerState<CreateGroupScreen> {
  final _nameController = TextEditingController();
  final _countyController = TextEditingController(text: '047');
  String _kind = 'CHAMA';
  bool _loading = false;
  String? _error;

  Future<void> _create() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.post('/v1/groups', {
        'orgKind': _kind,
        'officialName': _nameController.text.trim(),
        'county': _countyController.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(res['groupId']);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Start a group'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    "You'll be the group's chairperson and its first signer.",
                    style: TextStyle(color: EsokoColors.text2),
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  DropdownButtonFormField<String>(
                    initialValue: _kind,
                    decoration: const InputDecoration(labelText: 'Kind of group'),
                    items: [for (final k in _groupKinds) DropdownMenuItem(value: k.$1, child: Text(k.$2))],
                    onChanged: (v) => setState(() => _kind = v ?? _kind),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _nameController,
                    decoration: const InputDecoration(labelText: 'Group name'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _countyController,
                    decoration: const InputDecoration(labelText: 'County code', hintText: 'e.g. 047 for Nairobi'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s3),
                    Text(_error!, style: TextStyle(color: EsokoColors.red)),
                  ],
                  const SizedBox(height: EsokoSpacing.s5),
                  FilledButton(
                    onPressed: _loading ? null : _create,
                    child: _loading
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create group'),
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
