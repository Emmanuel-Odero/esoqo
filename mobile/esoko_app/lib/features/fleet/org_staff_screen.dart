import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'fleet_models.dart';
import 'fleet_providers.dart';
import 'fleet_repository.dart';

/// Manager console for who can act as staff for this org — the
/// unified-crew-identity roster (docs/proposals/
/// esoko-unified-crew-identity.md). Every row is a real Esoko account
/// (there is no account-less onboarding path here, by design), granted
/// SCANNER, MANAGER, ADMIN or CREW duty. Suspending kills that person's
/// live activated session immediately, server-side — this screen shows
/// the result, it doesn't do the killing itself. Reinstating only clears
/// the suspension flag; the person still needs a fresh OTP before they
/// can switch back on duty (core-go never auto-restores that).
class OrgStaffScreen extends ConsumerWidget {
  const OrgStaffScreen({super.key, required this.orgId, required this.orgName});
  final String orgId;
  final String orgName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: EsokoAppBar(
        title: 'Staff · $orgName',
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_alt_outlined),
            tooltip: 'Add staff',
            onPressed: () => _openAddStaffDialog(context, ref),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(orgStaffGrantsProvider(orgId)),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: _roster(context, ref),
            ),
          ),
        ),
      ),
    );
  }

  Widget _roster(BuildContext context, WidgetRef ref) {
    final grants = ref.watch(orgStaffGrantsProvider(orgId));
    return EsokoAsyncView(
      value: grants,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No staff added yet — everyone needs their own Esoko account first.',
      emptyIcon: Icons.badge_outlined,
      onRetry: () => ref.invalidate(orgStaffGrantsProvider(orgId)),
      data: (context, list) => ListView(
        padding: const EdgeInsets.all(EsokoSpacing.s4),
        children: [
          for (var i = 0; i < list.length; i++)
            EsokoStagger(
              index: i,
              child: _grantTile(context, ref, list[i]),
            ),
        ],
      ),
    );
  }

  Widget _grantTile(BuildContext context, WidgetRef ref, OrgStaffGrant grant) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: grant.partyName,
        subtitle: [grant.role, if (grant.msisdn != null) grant.msisdn!].join(' · '),
        icon: Icons.person_outline,
        // Blue, not green — SCREEN_CONVENTIONS.md: a staff roster row is
        // institution-scoped, not the signed-in person's own record.
        iconColor: EsokoColors.blue,
        iconBackground: EsokoColors.blueTint,
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            EsokoStatusPill(
              label: grant.suspended ? 'Suspended' : 'Active',
              color: grant.suspended ? Colors.red : EsokoColors.green,
            ),
            const SizedBox(width: EsokoSpacing.s2),
            PopupMenuButton<String>(
              onSelected: (action) => _onAction(context, ref, grant, action),
              itemBuilder: (context) => [
                if (grant.suspended)
                  const PopupMenuItem(value: 'reinstate', child: Text('Reinstate'))
                else
                  const PopupMenuItem(value: 'suspend', child: Text('Suspend')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _onAction(BuildContext context, WidgetRef ref, OrgStaffGrant grant, String action) async {
    final repo = ref.read(fleetRepositoryProvider);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(action == 'suspend' ? 'Suspend ${grant.partyName}?' : 'Reinstate ${grant.partyName}?'),
        content: Text(
          action == 'suspend'
              ? 'This ends any active session for them right now. They\'ll need to be reinstated, then verify with a fresh code, before they can act as staff again.'
              : 'This clears the suspension. They\'ll still need a fresh code to actually switch duty back on — nothing is restored automatically.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(action == 'suspend' ? 'Suspend' : 'Reinstate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      if (action == 'suspend') {
        await repo.suspendStaffGrant(orgId, grant.partyId);
      } else {
        await repo.reinstateStaffGrant(orgId, grant.partyId);
      }
      ref.invalidate(orgStaffGrantsProvider(orgId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(action == 'suspend' ? 'Suspended.' : 'Reinstated — they still need a fresh code to switch duty on.')),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _openAddStaffDialog(BuildContext context, WidgetRef ref) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _AddStaffDialog(orgId: orgId),
    );
    ref.invalidate(orgStaffGrantsProvider(orgId));
  }
}

class _AddStaffDialog extends ConsumerStatefulWidget {
  const _AddStaffDialog({required this.orgId});
  final String orgId;

  @override
  ConsumerState<_AddStaffDialog> createState() => _AddStaffDialogState();
}

class _AddStaffDialogState extends ConsumerState<_AddStaffDialog> {
  final _msisdnController = TextEditingController();
  String _role = 'SCANNER';
  String? _crewMemberId;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _msisdnController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final msisdn = _msisdnController.text.trim();
    if (msisdn.isEmpty) {
      setState(() => _error = 'Enter their phone number');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(fleetRepositoryProvider).createStaffGrant(
            orgId: widget.orgId,
            msisdn: msisdn,
            role: _role,
            crewMemberId: _role == 'CREW' ? _crewMemberId : null,
          );
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      // NO_ACCOUNT arrives here with core-go's own copy — "that number
      // doesn't have an Esoko account yet" — surfaced verbatim rather
      // than reworded, since it's already the exact actionable message.
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final crew = ref.watch(crewProvider(widget.orgId));
    return AlertDialog(
      title: const Text('Add staff'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('They need their own Esoko account already — look them up by phone number.'),
            const SizedBox(height: EsokoSpacing.s3),
            EsokoField.phone(
              controller: _msisdnController,
            ),
            const SizedBox(height: EsokoSpacing.s3),
            EsokoDropdown<String>(
              label: 'Role',
              initialValue: _role,
              items: const [
                DropdownMenuItem(value: 'SCANNER', child: Text('Scanner — check-in only')),
                DropdownMenuItem(value: 'MANAGER', child: Text('Manager — listings, schedules, bookings')),
                DropdownMenuItem(value: 'ADMIN', child: Text('Admin — everything, incl. staff')),
                DropdownMenuItem(value: 'CREW', child: Text('Crew — driver/conductor duty')),
              ],
              onChanged: (v) => setState(() => _role = v ?? 'SCANNER'),
            ),
            if (_role == 'CREW') ...[
              const SizedBox(height: EsokoSpacing.s3),
              crew.when(
                data: (list) => EsokoDropdown<String>(
                  label: 'Linked crew member (optional)',
                  initialValue: _crewMemberId,
                  items: [
                    for (final c in list.where((c) => c.active))
                      DropdownMenuItem(value: c.id, child: Text('${c.name} (${c.role})')),
                  ],
                  onChanged: (v) => setState(() => _crewMemberId = v),
                ),
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: EsokoSpacing.s3),
                  child: EsokoSkeleton(height: 44, radius: EsokoRadius.md),
                ),
                error: (_, _) => const Text('Could not load crew members.'),
              ),
              const SizedBox(height: EsokoSpacing.s1),
              const Text(
                'Without a link they can still declare cash but can\'t close a trip.',
                style: TextStyle(fontSize: 12),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              EsokoFormError(message: _error!),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.of(context).pop(), child: const Text('Cancel')),
        EsokoButton.primary(expand: false, label: 'Add', loading: _saving, onPressed: _save),
      ],
    );
  }
}
