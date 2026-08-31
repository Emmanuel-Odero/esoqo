import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

/// POST /v1/groups/:id/withdrawals — officer-only (core-go enforces
/// this; the form is reachable but the request will 403 for a non-
/// officer). Broadcasts to every eligible signer with a standby window
/// before it can execute — see RequestWithdrawal's own comment on the
/// Go side.
class RequestWithdrawalScreen extends ConsumerStatefulWidget {
  const RequestWithdrawalScreen({super.key, required this.groupId});
  final String groupId;

  @override
  ConsumerState<RequestWithdrawalScreen> createState() => _RequestWithdrawalScreenState();
}

class _RequestWithdrawalScreenState extends ConsumerState<RequestWithdrawalScreen> {
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
    if (_purposeController.text.trim().isEmpty || _payeeNameController.text.trim().isEmpty) {
      setState(() => _error = 'State the purpose and who this is paid to');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/groups/${widget.groupId}/withdrawals', {
        'amountKes': amount,
        'purpose': _purposeController.text.trim(),
        'payeeName': _payeeNameController.text.trim(),
        if (_payeeMsisdnController.text.trim().isNotEmpty) 'payeeMsisdn': _payeeMsisdnController.text.trim(),
      });
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
                  Container(
                    padding: const EdgeInsets.all(EsokoSpacing.s4),
                    decoration: BoxDecoration(color: EsokoColors.amberTint, borderRadius: BorderRadius.circular(EsokoRadius.md)),
                    child: Row(
                      children: [
                        Icon(Icons.info_outline, color: EsokoColors.amber, size: 20),
                        const SizedBox(width: EsokoSpacing.s2),
                        Expanded(
                          child: Text(
                            "This goes to every signer for approval and won't move money until the group's standby window passes.",
                            style: TextStyle(fontSize: 12, color: EsokoColors.text2),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  TextField(
                    controller: _amountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Amount (KES)', prefixIcon: Icon(Icons.payments_outlined)),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _purposeController,
                    decoration: const InputDecoration(labelText: 'Purpose', hintText: 'e.g. Venue deposit for AGM'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _payeeNameController,
                    decoration: const InputDecoration(labelText: 'Paid to (name)'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _payeeMsisdnController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Payee phone (optional)', hintText: '+254 7…'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s3),
                    Text(_error!, style: TextStyle(color: EsokoColors.red)),
                  ],
                  const SizedBox(height: EsokoSpacing.s5),
                  FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: _loading
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Broadcast to signers'),
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
