import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'groups_repository.dart';

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
      final groupId = await ref
          .read(groupsRepositoryProvider)
          .createGroup(
            kind: _kind,
            officialName: _nameController.text.trim(),
            county: _countyController.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(groupId);
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
                    // Theme-derived, not the fixed EsokoColors.text2 —
                    // this sits on the scaffold background, which
                    // switches between paper and darkSurface.
                    style: TextStyle(
                      color: Theme.of(context).textTheme.bodySmall?.color,
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoDropdown<String>(
                    label: 'Kind of group',
                    initialValue: _kind,
                    items: [
                      for (final k in _groupKinds)
                        DropdownMenuItem(value: k.$1, child: Text(k.$2)),
                    ],
                    onChanged: (v) => setState(() => _kind = v ?? _kind),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoField.text(
                    controller: _nameController,
                    label: 'Group name',
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoField.quantity(
                    controller: _countyController,
                    label: 'County code',
                    helper: 'e.g. 047 for Nairobi',
                    onSubmitted: (_) => _create(),
                  ),
                  if (_error != null) EsokoFormError(message: _error!),
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoButton.primary(
                    expand: false,
                    label: 'Create group',
                    loading: _loading,
                    onPressed: _create,
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
