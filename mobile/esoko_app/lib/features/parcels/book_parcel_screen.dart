import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcels_repository.dart';

/// Booking a parcel — sender's name/phone, receiver's, and a plain-
/// text origin/destination (no geocoding, same reasoning as Bill.
/// accountRef: a human-readable description is more useful to a
/// courier than a lat/lng this app doesn't collect). No payment here —
/// this is logistics tracking, not a marketplace.
class BookParcelScreen extends ConsumerStatefulWidget {
  const BookParcelScreen({super.key});

  @override
  ConsumerState<BookParcelScreen> createState() => _BookParcelScreenState();
}

class _BookParcelScreenState extends ConsumerState<BookParcelScreen> {
  final _senderName = TextEditingController();
  final _senderMsisdn = TextEditingController();
  final _receiverName = TextEditingController();
  final _receiverMsisdn = TextEditingController();
  final _origin = TextEditingController();
  final _destination = TextEditingController();
  final _notes = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _senderName.dispose();
    _senderMsisdn.dispose();
    _receiverName.dispose();
    _receiverMsisdn.dispose();
    _origin.dispose();
    _destination.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    if ([
      _senderName,
      _senderMsisdn,
      _receiverName,
      _receiverMsisdn,
      _origin,
      _destination,
    ].any((c) => c.text.trim().isEmpty)) {
      setState(() => _error = 'Fill in every field above.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final booked = await ref.read(parcelsRepositoryProvider).bookParcel(
            senderName: _senderName.text.trim(),
            senderMsisdn: _senderMsisdn.text.trim(),
            receiverName: _receiverName.text.trim(),
            receiverMsisdn: _receiverMsisdn.text.trim(),
            originLabel: _origin.text.trim(),
            destinationLabel: _destination.text.trim(),
            notes: _notes.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(booked.code);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Send a parcel'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              children: [
                EsokoSubHeader('Sender'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _senderName,
                  label: 'Your name',
                  icon: Icons.person_outline,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _senderMsisdn,
                  label: 'Your phone',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: EsokoSpacing.s5),
                EsokoSubHeader('Receiver'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _receiverName,
                  label: 'Their name',
                  icon: Icons.person_outline,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _receiverMsisdn,
                  label: 'Their phone',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: EsokoSpacing.s5),
                EsokoSubHeader('Route'),
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormField(
                  controller: _origin,
                  label: 'Picking up from',
                  hint: 'e.g. Westlands, opposite Sarit',
                  icon: Icons.trip_origin,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _destination,
                  label: 'Delivering to',
                  hint: 'e.g. Kisumu, Milimani estate',
                  icon: Icons.place_outlined,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _notes,
                  label: 'Notes (optional)',
                  hint: 'e.g. Fragile',
                ),
                if (_error != null) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormError(message: _error!),
                ],
                const SizedBox(height: EsokoSpacing.s5),
                EsokoLoadingButton(
                  label: 'Book parcel',
                  loading: _busy,
                  onPressed: _book,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
