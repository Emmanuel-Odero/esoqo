import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'groups_repository.dart';

/// POST /v1/groups/:id/withdrawals — officer-only (core-go enforces
/// this; the form is reachable but the request will 403 for a non-
/// officer). Broadcasts to every eligible signer with a standby window
/// before it can execute — see RequestWithdrawal's own comment on the
/// Go side.
class RequestWithdrawalScreen extends ConsumerStatefulWidget {
  const RequestWithdrawalScreen({super.key, required this.groupId});
  final String groupId;

  @override
  ConsumerState<RequestWithdrawalScreen> createState() =>
      _RequestWithdrawalScreenState();
}

class _RequestWithdrawalScreenState
    extends ConsumerState<RequestWithdrawalScreen> {
  final _amountController = TextEditingController();
  final _purposeController = TextEditingController();
  final _payeeNameController = TextEditingController();
  final _payeeMsisdnController = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter an amount above zero');
      return;
    }
    if (_purposeController.text.trim().isEmpty ||
        _payeeNameController.text.trim().isEmpty) {
      setState(() => _error = 'State the purpose and who this is paid to');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(groupsRepositoryProvider)
          .requestWithdrawal(
            groupId: widget.groupId,
            amountKes: amount,
            purpose: _purposeController.text.trim(),
            payeeName: _payeeNameController.text.trim(),
            payeeMsisdn: _payeeMsisdnController.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Request withdrawal'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const EsokoInlineNotice(
                    icon: EsokoIconName.info,
                    message: "This goes to every signer for approval and won't move money until the group's standby window passes.",
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoField.amount(
                    controller: _amountController,
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoField.text(
                    controller: _purposeController,
                    label: 'Purpose',
                    hint: 'e.g. Venue deposit for AGM',
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoField.name(
                    controller: _payeeNameController,
                    label: 'Paid to (name)',
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoField.phone(
                    controller: _payeeMsisdnController,
                    label: 'Payee phone (optional)',
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) EsokoFormError(message: _error!),
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoButton.primary(
                    expand: false,
                    label: 'Broadcast to signers',
                    esokoIcon: EsokoIconName.send,
                    loading: _loading,
                    onPressed: _submit,
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
