import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

/// Who you are, and the code other people scan to pay you.
///
/// Split out of the old one-scroll Account screen: identity and the
/// payment QR are the two things that answer "who am I on Esoko", and
/// they belong behind one door rather than stacked above a PIN form
/// somebody visits twice a year.
class AccountDetailsScreen extends ConsumerStatefulWidget {
  const AccountDetailsScreen({super.key});

  @override
  ConsumerState<AccountDetailsScreen> createState() =>
      _AccountDetailsScreenState();
}

class _AccountDetailsScreenState extends ConsumerState<AccountDetailsScreen> {
  final _nameController = TextEditingController();
  bool _editing = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter the name people call you');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).updateName(name);
      if (mounted) {
        setState(() {
          _editing = false;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Scaffold(
        appBar: EsokoAppBar(title: 'Your details'),
        body: Padding(
          padding: EdgeInsets.all(EsokoSpacing.s5),
          child: EsokoSkeletonList(count: 3),
        ),
      );
    }
    final profile = auth.profile;

    return Scaffold(
      appBar: const EsokoAppBar(title: 'Your details'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              children: [
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
                      if (_editing) ...[
                        EsokoField.name(
                          controller: _nameController,
                          label: 'What people call you',
                          hint: profile.displayName,
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _save(),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: EsokoSpacing.s2),
                          EsokoFormError(message: _error!),
                        ],
                        const SizedBox(height: EsokoSpacing.s3),
                        Row(
                          children: [
                            Expanded(
                              child: EsokoButton.primary(
                                expand: false,
                                label: 'Save name',
                                icon: Icons.check_outlined,
                                loading: _saving,
                                onPressed: _save,
                              ),
                            ),
                            const SizedBox(width: EsokoSpacing.s2),
                            EsokoButton.tertiary(
                              label: 'Cancel',
                              onPressed: _saving
                                  ? null
                                  : () => setState(() {
                                      _editing = false;
                                      _error = null;
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
                            setState(() => _editing = true);
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
                              // Deliberately always white, in both
                              // themes. A QR needs a white backing for
                              // reliable camera scanning regardless of
                              // app theme; a dark backing makes it
                              // harder for other people's phones to
                              // read this code.
                              color: Colors.white,
                              borderRadius:
                                  BorderRadius.circular(EsokoRadius.md),
                              border: Border.all(color: EsokoColors.line),
                            ),
                            child:
                                QrImageView(data: profile.esokoId!, size: 200),
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
                              color:
                                  Theme.of(context).textTheme.bodySmall?.color,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
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
