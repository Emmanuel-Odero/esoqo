import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcels_repository.dart';

enum _Step { requestCode, verify, done }

/// The receiver's own "I got it" confirmation — no Esoko account
/// needed, only proof of control of the number already on the parcel
/// (see dbx.RequestParcelReceiptOtp). Two steps: send a code to the
/// masked number the server already has on file (never one typed
/// here), then verify it alongside a 1–5 condition rating. Modeled on
/// OtpSignInScreen's phone→code shape, minus the phone-entry step —
/// there's nothing for the receiver to type until the code itself.
class ParcelReceiptConfirmationScreen extends ConsumerStatefulWidget {
  const ParcelReceiptConfirmationScreen({super.key, required this.code});
  final String code;

  @override
  ConsumerState<ParcelReceiptConfirmationScreen> createState() =>
      _ParcelReceiptConfirmationScreenState();
}

class _ParcelReceiptConfirmationScreenState
    extends ConsumerState<ParcelReceiptConfirmationScreen> {
  final _otpController = TextEditingController();
  final _feedbackController = TextEditingController();
  _Step _step = _Step.requestCode;
  String? _maskedMsisdn;
  int _rating = 0;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _otpController.dispose();
    _feedbackController.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final masked = await ref
          .read(parcelsRepositoryProvider)
          .requestReceiptOtp(widget.code);
      setState(() {
        _maskedMsisdn = masked;
        _step = _Step.verify;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _confirm() async {
    if (_rating == 0) {
      setState(() => _error = 'Rate the condition it arrived in.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(parcelsRepositoryProvider).confirmReceipt(
            code: widget.code,
            otpCode: _otpController.text.trim(),
            conditionRating: _rating,
            feedback: _feedbackController.text.trim(),
          );
      setState(() => _step = _Step.done);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Confirm receipt'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              children: [
                ..._stepContent(),
                if (_error != null) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormError(message: _error!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _stepContent() {
    switch (_step) {
      case _Step.requestCode:
        return [
          const Text(
            "Confirming lets the sender know their parcel arrived safely — "
            "we'll text a code to the phone number on file for this delivery.",
          ),
          const SizedBox(height: EsokoSpacing.s5),
          EsokoButton.primary(
            expand: false,
            label: 'Send code',
            loading: _loading,
            onPressed: _requestCode,
          ),
        ];
      case _Step.verify:
        return [
          Text('Enter the code sent to ${_maskedMsisdn ?? 'your number'}.'),
          const SizedBox(height: EsokoSpacing.s4),
          EsokoField.otp(
            controller: _otpController,
            label: '6-digit code',
            autofocus: false,
          ),
          const SizedBox(height: EsokoSpacing.s4),
          const Text(
            'How did it arrive?',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: EsokoSpacing.s2),
          EsokoStarRating(
            value: _rating,
            onChanged: (v) => setState(() => _rating = v),
          ),
          const SizedBox(height: EsokoSpacing.s4),
          TextField(
            controller: _feedbackController,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Feedback (optional)'),
          ),
          const SizedBox(height: EsokoSpacing.s5),
          EsokoButton.primary(
            expand: false,
            label: 'Confirm receipt',
            loading: _loading,
            onPressed: _confirm,
          ),
        ];
      case _Step.done:
        return [
          EsokoResultView.success(
            title: 'Thanks!',
            message: "We've let the sender know you got it.",
            primaryLabel: 'Done',
            onPrimary: () => Navigator.of(context).pop(true),
          ),
        ];
    }
  }
}
