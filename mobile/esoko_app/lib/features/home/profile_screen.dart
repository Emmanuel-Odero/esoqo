import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../shopping/order_detail_screen.dart';
import 'profile_repository.dart';

final _historyProvider = FutureProvider.autoDispose<List<HistoryItem>>(
  (ref) => ref.watch(profileRepositoryProvider).myHistory(),
);

final _pointsProvider = FutureProvider.autoDispose<int>(
  (ref) => ref.watch(profileRepositoryProvider).myPoints(),
);

/// The "Settings" tab body — account identity (now editable), security
/// (change PIN), loyalty points and history. Formerly the standalone
/// "Profile" tab; it moved here so the bottom nav stays at Home +
/// Settings.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
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
    final history = ref.watch(_historyProvider);
    final points = ref.watch(_pointsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(_historyProvider);
        ref.invalidate(_pointsProvider);
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
                    _row('Name', profile.displayName),
                    if (profile.msisdn != null) _row('Phone', profile.msisdn!),
                    if (profile.esokoId != null)
                      _row(
                        'Esoko ID',
                        profile.esokoId!,
                        mono: true,
                        copyable: true,
                        context: context,
                      )
                    else
                      _row('Esoko ID', 'Preparing…'),
                    const SizedBox(height: EsokoSpacing.s3),
                    if (_editingName) ...[
                      EsokoFormField(
                        controller: _nameController,
                        label: 'What people call you',
                        hint: profile.displayName,
                        icon: Icons.person_outline,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.name],
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
                            child: EsokoLoadingButton(
                              label: 'Save name',
                              icon: Icons.check_outlined,
                              loading: _savingName,
                              onPressed: _saveName,
                            ),
                          ),
                          const SizedBox(width: EsokoSpacing.s2),
                          TextButton(
                            onPressed: _savingName
                                ? null
                                : () => setState(() {
                                    _editingName = false;
                                    _nameError = null;
                                  }),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ] else
                      OutlinedButton.icon(
                        onPressed: () {
                          _nameController.text = profile.knownAs ?? '';
                          setState(() => _editingName = true);
                        },
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: const Text('Edit name'),
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
                      'My payment QR',
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
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Clipboard.setData(
                              ClipboardData(text: profile.esokoId!),
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Esoko ID copied — share or type it anywhere'),
                              ),
                            );
                          },
                          icon: const Icon(Icons.copy_outlined, size: 16),
                          label: const Text('Copy code'),
                        ),
                      ),
                    ] else ...[
                      const SizedBox(height: EsokoSpacing.s3),
                      Center(
                        child: Text(
                          'Preparing your payment code…',
                          style: TextStyle(color: EsokoColors.text2),
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
                      EsokoFormField(
                        controller: _pinController,
                        label: 'New PIN',
                        hint: '4 to 6 digits',
                        icon: Icons.lock_outline,
                        keyboardType: TextInputType.number,
                        obscureText: true,
                        maxLength: 6,
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: EsokoSpacing.s3),
                      EsokoFormField(
                        controller: _pinConfirmController,
                        label: 'Repeat new PIN',
                        icon: Icons.lock_outline,
                        keyboardType: TextInputType.number,
                        obscureText: true,
                        maxLength: 6,
                        textInputAction: TextInputAction.done,
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
                            child: EsokoLoadingButton(
                              label: 'Change PIN',
                              icon: Icons.lock_outline,
                              loading: _savingPin,
                              onPressed: _savePin,
                            ),
                          ),
                          const SizedBox(width: EsokoSpacing.s2),
                          TextButton(
                            onPressed: _savingPin
                                ? null
                                : () => setState(() {
                                    _changingPin = false;
                                    _pinError = null;
                                    _pinDone = null;
                                  }),
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ] else
                      OutlinedButton.icon(
                        onPressed: () => setState(() => _changingPin = true),
                        icon: const Icon(Icons.lock_outline, size: 16),
                        label: const Text('Change PIN'),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s4),

              points.when(
                data: (total) {
                  final scheme = Theme.of(context).colorScheme;
                  return EsokoCard(
                    color: scheme.primaryContainer,
                    padding: const EdgeInsets.all(EsokoSpacing.s5),
                    child: Row(
                      children: [
                        Icon(Icons.stars_rounded, color: scheme.primary),
                        const SizedBox(width: EsokoSpacing.s3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '$total points',
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const Text(
                                'Loyalty points across shops and tickets',
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: EsokoSpacing.s2),
                  child: EsokoSkeletonCard(leading: false, lines: 2),
                ),
                error: (_, _) =>
                    const EsokoFormError(message: 'Points unavailable'),
              ),
              const SizedBox(height: EsokoSpacing.s6),

              const EsokoSubHeader('History'),
              const SizedBox(height: EsokoSpacing.s3),
              EsokoAsyncView(
                value: history,
                isEmpty: (items) => items.isEmpty,
                emptyMessage: 'No orders or bookings yet.',
                emptyIcon: Icons.receipt_long_outlined,
                onRetry: () => ref.invalidate(_historyProvider),
                data: (context, items) => Column(
                  children: [
                    for (var i = 0; i < items.length; i++)
                      EsokoStagger(
                        index: i,
                        child: _historyTile(context, items[i]),
                      ),
                  ],
                ),
              ),

              const SizedBox(height: EsokoSpacing.s6),
              OutlinedButton(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _historyTile(BuildContext context, HistoryItem item) {
    final icon = item.kind == 'order'
        ? Icons.storefront_outlined
        : Icons.confirmation_num_outlined;
    // Only orders have a detail screen today (pickup status, code,
    // directions) — a ticket booking's "detail" is already the My
    // tickets tab, so a booking tile stays informational for now.
    final tappable = item.kind == 'order';
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: item.title,
        subtitle:
            '${item.status} · ${_formatDate(item.occurredAt)} · KES ${item.totalKes}',
        icon: icon,
        onTap: tappable
            ? () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => OrderDetailScreen(orderId: item.id),
                ),
              )
            : null,
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Widget _row(
    String label,
    String value, {
    bool mono = false,
    bool copyable = false,
    BuildContext? context,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: EsokoSpacing.s2),
      child: Row(
        children: [
          SizedBox(
            width: 90,
            child: Text(label, style: TextStyle(color: EsokoColors.text2)),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontFamily: mono ? 'monospace' : null),
            ),
          ),
          if (copyable && context != null)
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
