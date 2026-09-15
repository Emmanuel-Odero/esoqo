import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';

/// Who you are, and the code other people scan to pay you.
///
/// Split out of the old one-scroll Account screen: identity and the
/// payment QR are the two things that answer "who am I on Esoqo", and
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
        appBar: EsoqoAppBar(title: 'Your details'),
        body: Padding(
          padding: EdgeInsets.all(EsoqoSpacing.s5),
          child: EsoqoSkeletonList(count: 3),
        ),
      );
    }
    final profile = auth.profile;

    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Your details'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s6),
              children: [
                EsoqoCard(
                  padding: const EdgeInsets.all(EsoqoSpacing.s5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _row('Name', profile.displayName, context),
                      if (profile.msisdn != null)
                        _row('Phone', profile.msisdn!, context),
                      if (profile.esoqoId != null)
                        _row(
                          'Esoqo ID',
                          profile.esoqoId!,
                          context,
                          mono: true,
                          copyable: true,
                        )
                      else
                        _row('Esoqo ID', 'Preparing…', context),
                      const SizedBox(height: EsoqoSpacing.s3),
                      if (_editing) ...[
                        EsoqoField.name(
                          controller: _nameController,
                          label: 'What people call you',
                          hint: profile.displayName,
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _save(),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: EsoqoSpacing.s2),
                          EsoqoFormError(message: _error!),
                        ],
                        const SizedBox(height: EsoqoSpacing.s3),
                        Row(
                          children: [
                            Expanded(
                              child: EsoqoButton.primary(
                                expand: false,
                                label: 'Save name',
                                icon: Icons.check_outlined,
                                loading: _saving,
                                onPressed: _save,
                              ),
                            ),
                            const SizedBox(width: EsoqoSpacing.s2),
                            EsoqoButton.tertiary(
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
                        EsoqoButton.secondary(
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
                const SizedBox(height: EsoqoSpacing.s4),
                EsoqoCard(
                  padding: const EdgeInsets.all(EsoqoSpacing.s5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Your payment QR',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: EsoqoSpacing.s2),
                      const Text(
                        'Show this when paying at a shop or to another person.',
                      ),
                      if (profile.esoqoId != null) ...[
                        const SizedBox(height: EsoqoSpacing.s4),
                        Center(
                          child: Container(
                            padding: const EdgeInsets.all(EsoqoSpacing.s3),
                            decoration: BoxDecoration(
                              // Deliberately always white, in both
                              // themes. A QR needs a white backing for
                              // reliable camera scanning regardless of
                              // app theme; a dark backing makes it
                              // harder for other people's phones to
                              // read this code.
                              color: Colors.white,
                              borderRadius:
                                  BorderRadius.circular(EsoqoRadius.md),
                              border: Border.all(color: EsoqoColors.line),
                            ),
                            child:
                                QrImageView(data: profile.esoqoId!, size: 200),
                          ),
                        ),
                        const SizedBox(height: EsoqoSpacing.s3),
                        Center(
                          child: Text(
                            profile.esoqoId!,
                            style: EsoqoTypography.code(),
                          ),
                        ),
                        const SizedBox(height: EsoqoSpacing.s2),
                        Center(
                          child: EsoqoButton.secondary(
                            label: 'Copy code',
                            icon: Icons.copy_outlined,
                            expand: false,
                            onPressed: () {
                              Clipboard.setData(
                                ClipboardData(text: profile.esoqoId!),
                              );
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Esoqo ID copied — share or type it anywhere',
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ] else ...[
                        const SizedBox(height: EsoqoSpacing.s3),
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
      padding: const EdgeInsets.symmetric(vertical: EsoqoSpacing.s2),
      child: Row(
        children: [
          SizedBox(
            width: 90,
            // Theme-derived, not the fixed EsoqoColors.text2 — this
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
              style: mono ? EsoqoTypography.mono() : null,
            ),
          ),
          if (copyable)
            IconButton(
              icon: const Icon(Icons.copy_outlined, size: 18),
              tooltip: 'Copy Esoqo ID',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Esoqo ID copied')),
                );
              },
            ),
        ],
      ),
    );
  }
}
