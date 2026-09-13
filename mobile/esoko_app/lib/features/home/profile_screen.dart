import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/fleet_models.dart';
import '../fleet/fleet_providers.dart';
import '../fleet/org_fleet_screen.dart';
import 'org_duty_switcher_screen.dart';

/// The "Account" tab body — identity (editable), payment QR, security
/// (change PIN), and the companies/duty grants you hold. Loyalty
/// points moved to Money and order/booking history moved to Activity —
/// both are answers to "what's mine" or "what happened", not "who am
/// I", and burying them here under Sign out was why this screen ran to
/// 608 lines with the one thing genuinely about the account (a name, a
/// PIN) sandwiched in the middle.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  final _nameController = TextEditingController();
  final _pinController = TextEditingController();
  final _pinConfirmController = TextEditingController();
  bool _editingName = false;
  bool _savingName = false;
  bool _changingPin = false;
  bool _savingPin = false;
  String? _nameError;
  String? _pinError;
  String? _pinDone;

  @override
  void dispose() {
    _nameController.dispose();
    _pinController.dispose();
    _pinConfirmController.dispose();
    super.dispose();
  }

  Future<void> _saveName() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _nameError = 'Enter the name people call you');
      return;
    }
    setState(() {
      _savingName = true;
      _nameError = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).updateName(name);
      if (mounted) {
        setState(() {
          _editingName = false;
          _nameError = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _nameError = e.message);
    } finally {
      if (mounted) setState(() => _savingName = false);
    }
  }

  Future<void> _savePin() async {
    final pin = _pinController.text.trim();
    final confirm = _pinConfirmController.text.trim();
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      setState(() => _pinError = 'PIN must be 4 to 6 digits');
      return;
    }
    if (pin != confirm) {
      setState(() => _pinError = 'The two PINs do not match');
      return;
    }
    setState(() {
      _savingPin = true;
      _pinError = null;
      _pinDone = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).setPin(pin);
      if (mounted) {
        setState(() {
          _pinDone = 'PIN changed';
          _pinController.clear();
          _pinConfirmController.clear();
        });
      }
    } on ApiException catch (e) {
      // WEAK_PIN and friends arrive here with the server's own copy.
      if (mounted) setState(() => _pinError = e.message);
    } finally {
      if (mounted) setState(() => _savingPin = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Padding(
        padding: EdgeInsets.all(EsokoSpacing.s5),
        child: EsokoSkeletonList(count: 5),
      );
    }
    final profile = auth.profile;

    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(orgContextControllerProvider.notifier).refreshGrants();
        ref.invalidate(myOrgsProvider);
      },
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: ListView(
            padding: const EdgeInsets.all(EsokoSpacing.s6),
            children: [
              EsokoSectionHeader(
                title: 'Account',
                subtitle: 'Everything Esoko holds about you — nobody else sees any of it unless you say so.',
              ),
              const SizedBox(height: EsokoSpacing.s6),

              EsokoCard(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _row('Name', profile.displayName, context),
                    if (profile.msisdn != null)
                      _row('Phone', profile.msisdn!, context),
                    if (profile.esokoId != null)
                      _row(
                        'Esoko ID',
                        profile.esokoId!,
                        context,
                        mono: true,
                        copyable: true,
                      )
                    else
                      _row('Esoko ID', 'Preparing…', context),
                    const SizedBox(height: EsokoSpacing.s3),
                    if (_editingName) ...[
                      EsokoField.name(
                        controller: _nameController,
                        label: 'What people call you',
                        hint: profile.displayName,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _saveName(),
                      ),
                      if (_nameError != null) ...[
                        const SizedBox(height: EsokoSpacing.s2),
                        EsokoFormError(message: _nameError!),
                      ],
                      const SizedBox(height: EsokoSpacing.s3),
                      Row(
                        children: [
                          Expanded(
                            child: EsokoButton.primary(
                              expand: false,
                              label: 'Save name',
                              icon: Icons.check_outlined,
                              loading: _savingName,
                              onPressed: _saveName,
                            ),
                          ),
                          const SizedBox(width: EsokoSpacing.s2),
                          EsokoButton.tertiary(
                            label: 'Cancel',
                            onPressed: _savingName
                                ? null
                                : () => setState(() {
                                    _editingName = false;
                                    _nameError = null;
                                  }),
                          ),
                        ],
                      ),
                    ] else
                      EsokoButton.secondary(
                        label: 'Edit name',
                        icon: Icons.edit_outlined,
                        expand: false,
                        onPressed: () {
                          _nameController.text = profile.knownAs ?? '';
                          setState(() => _editingName = true);
                        },
                      ),
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s4),

              EsokoCard(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Your payment QR',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: EsokoSpacing.s2),
                    const Text(
                      'Show this when paying at a shop or to another person.',
                    ),
                    if (profile.esokoId != null) ...[
                      const SizedBox(height: EsokoSpacing.s4),
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(EsokoSpacing.s3),
                          decoration: BoxDecoration(
                            // Deliberately always white, in both themes
                            // — not a contrast bug like the others in
                            // this sweep. A QR code needs a white
                            // backing for reliable camera scanning
                            // regardless of app theme; a dark backing
                            // would make it harder for other people's
                            // phones to scan this code.
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(EsokoRadius.md),
                            border: Border.all(color: EsokoColors.line),
                          ),
                          child: QrImageView(data: profile.esokoId!, size: 200),
                        ),
                      ),
                      const SizedBox(height: EsokoSpacing.s3),
                      Center(
                        child: Text(
                          profile.esokoId!,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1,
                          ),
                        ),
                      ),
                      const SizedBox(height: EsokoSpacing.s2),
                      Center(
                        child: EsokoButton.secondary(
                          label: 'Copy code',
                          icon: Icons.copy_outlined,
                          expand: false,
                          onPressed: () {
                            Clipboard.setData(
                              ClipboardData(text: profile.esokoId!),
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Esoko ID copied — share or type it anywhere',
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ] else ...[
                      const SizedBox(height: EsokoSpacing.s3),
                      Center(
                        child: Text(
                          'Preparing your payment code…',
                          style: TextStyle(
                            color: Theme.of(context).textTheme.bodySmall?.color,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s4),

              EsokoCard(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Security',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: EsokoSpacing.s2),
                    const Text('Change the PIN you sign in with.'),
                    const SizedBox(height: EsokoSpacing.s3),
                    if (_changingPin) ...[
                      EsokoField.pin(
                        controller: _pinController,
                        label: 'New PIN',
                        helper: '4 to 6 digits',
                        autofill: PinAutofill.create,
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: EsokoSpacing.s3),
                      // No autofill on the repeat: filling it from the
                      // keychain would defeat the point of asking twice.
                      EsokoField.pin(
                        controller: _pinConfirmController,
                        label: 'Repeat new PIN',
                        onSubmitted: (_) => _savePin(),
                      ),
                      if (_pinError != null) ...[
                        const SizedBox(height: EsokoSpacing.s2),
                        EsokoFormError(message: _pinError!),
                      ],
                      if (_pinDone != null) ...[
                        const SizedBox(height: EsokoSpacing.s2),
                        Text(
                          _pinDone!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.primary,
                          ),
                        ),
                      ],
                      const SizedBox(height: EsokoSpacing.s3),
                      Row(
                        children: [
                          Expanded(
                            child: EsokoButton.primary(
                              expand: false,
                              label: 'Change PIN',
                              icon: Icons.lock_outline,
                              loading: _savingPin,
                              onPressed: _savePin,
                            ),
                          ),
                          const SizedBox(width: EsokoSpacing.s2),
                          EsokoButton.tertiary(
                            label: 'Cancel',
                            onPressed: _savingPin
                                ? null
                                : () => setState(() {
                                    _changingPin = false;
                                    _pinError = null;
                                    _pinDone = null;
                                  }),
                          ),
                        ],
                      ),
                    ] else
                      EsokoButton.secondary(
                        label: 'Change PIN',
                        icon: Icons.lock_outline,
                        expand: false,
                        onPressed: () => setState(() => _changingPin = true),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s4),

              _MyCompaniesAndRoles(),
              const SizedBox(height: EsokoSpacing.s6),
              EsokoButton.secondary(
                label: 'Sign out',
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(
    String label,
    String value,
    BuildContext context, {
    bool mono = false,
    bool copyable = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s2),
      child: Row(
        children: [
          SizedBox(
            width: 90,
            // Theme-derived, not the fixed EsokoColors.text2 — this
            // card's surface flips between light and dark with the
            // theme.
            child: Text(
              label,
              style: TextStyle(
                color: Theme.of(context).textTheme.bodySmall?.color,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontFamily: mono ? 'monospace' : null),
            ),
          ),
          if (copyable)
            IconButton(
              icon: const Icon(Icons.copy_outlined, size: 18),
              tooltip: 'Copy Esoko ID',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Esoko ID copied')),
                );
              },
            ),
        ],
      ),
    );
  }
}

/// Consolidates what used to be scattered across the app: companies the
/// signed-in person owns (previously only discoverable inside whichever
/// vertical tab they happened to live under — Transport for a fleet
/// company, nowhere yet on mobile for an events company) and staff
/// duty grants (previously a single unlabelled "Acting as" row). One
/// place, per docs/proposals/esoko-unified-crew-identity.md's "log in
/// once, see everything you're entitled to" intent. Renders nothing for
/// a plain subject with neither — no empty section clutter for the
/// common case.
class _MyCompaniesAndRoles extends ConsumerWidget {
  const _MyCompaniesAndRoles();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orgs = ref.watch(myOrgsProvider).valueOrNull ?? const <OrgSummary>[];
    final grants = ref.watch(orgContextControllerProvider).grants;
    if (orgs.isEmpty && grants.isEmpty) return const SizedBox.shrink();

    return EsokoCard(
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your companies & roles', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: EsokoSpacing.s1),
          const Text('Every company you own, and every staff duty you can switch on.'),
          if (orgs.isNotEmpty) ...[
            const SizedBox(height: EsokoSpacing.s4),
            for (final org in orgs) _ownedOrgTile(context, org),
          ],
          if (grants.isNotEmpty) ...[
            const SizedBox(height: EsokoSpacing.s4),
            for (final grant in grants) _grantTile(context, grant),
            const SizedBox(height: EsokoSpacing.s2),
            EsokoButton.secondary(
              label: 'Switch duty',
              icon: Icons.swap_horiz,
              expand: false,
              onPressed: () => showHatsQuickSwitchSheet(context),
            ),
          ],
        ],
      ),
    );
  }

  // Blue, not green — SCREEN_CONVENTIONS.md's colour rule: a company is
  // an institution, not the person's own record, even when they own it.
  Widget _ownedOrgTile(BuildContext context, OrgSummary org) {
    final manageable = org.vertical == 'TRANSPORT';
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: org.name,
        subtitle: '${org.vertical} · ${org.status}',
        iconColor: EsokoColors.blue,
        iconBackground: EsokoColors.blueTint,
        icon: Icons.storefront_outlined,
        trailing: manageable ? null : const EsokoStatusPill(label: 'Web console', color: EsokoColors.blue),
        onTap: manageable
            ? () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => OrgFleetScreen(orgId: org.id, orgName: org.name)),
                )
            : () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Manage this company from the Esoko web console for now.')),
                ),
      ),
    );
  }

  Widget _grantTile(BuildContext context, OrgGrant grant) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: grant.orgName,
        subtitle: grant.suspended ? 'Suspended' : '${grant.role}${grant.active ? ' · on duty' : ''}',
        iconColor: EsokoColors.blue,
        iconBackground: EsokoColors.blueTint,
        icon: Icons.badge_outlined,
        trailing: grant.suspended
            ? const EsokoStatusPill(label: 'Suspended', color: Colors.red)
            : grant.active
                ? const EsokoStatusPill(label: 'On duty', color: EsokoColors.green)
                : null,
      ),
    );
  }
}
