import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';

enum _Stage { form, submitting, done, failed }

/// POST /v1/groups/:id/contributions — pay by M-Pesa STK (confirmed
/// immediately, same console-auto-confirm convenience as shopping/
/// ticketing checkout) or declare a cash/bank contribution for an
/// officer to confirm later.
class ContributeScreen extends ConsumerStatefulWidget {
  const ContributeScreen({super.key, required this.groupId});
  final String groupId;

  @override
  ConsumerState<ContributeScreen> createState() => _ContributeScreenState();
}

class _ContributeScreenState extends ConsumerState<ContributeScreen> {
  final _amountController = TextEditingController();
  String _method = 'MPESA';
  _Stage _stage = _Stage.form;
  String? _error;
  String? _resultStatus;

  Future<void> _submit() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter an amount above zero');
      return;
    }
    setState(() {
      _stage = _Stage.submitting;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.post('/v1/groups/${widget.groupId}/contributions', {
        'amountKes': amount,
        'method': _method,
      });
      setState(() {
        _resultStatus = res['status'] as String?;
        _stage = _Stage.done;
      });
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _stage = _Stage.failed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Contribute'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(padding: const EdgeInsets.all(EsokoSpacing.s6), child: _body()),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_stage) {
      case _Stage.form:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount (KES)', prefixIcon: Icon(Icons.payments_outlined)),
            ),
            const SizedBox(height: EsokoSpacing.s4),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'MPESA', label: Text('M-Pesa'), icon: Icon(Icons.phone_iphone_outlined)),
                ButtonSegment(value: 'CASH_TO_AGENT', label: Text('Cash'), icon: Icon(Icons.money_outlined)),
              ],
              selected: {_method},
              onSelectionChanged: (s) => setState(() => _method = s.first),
            ),
            if (_method != 'MPESA')
              Padding(
                padding: const EdgeInsets.only(top: EsokoSpacing.s2),
                child: Text(
                  'This records your claim — an officer confirms it once the cash is actually in hand.',
                  style: TextStyle(color: EsokoColors.text2, fontSize: 12),
                ),
              ),
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              Text(_error!, style: TextStyle(color: EsokoColors.red)),
            ],
            const SizedBox(height: EsokoSpacing.s5),
            FilledButton(onPressed: _submit, child: Text(_method == 'MPESA' ? 'Pay with M-Pesa' : 'Declare contribution')),
          ],
        );
      case _Stage.submitting:
        return const Center(child: CircularProgressIndicator());
      case _Stage.done:
        final confirmed = _resultStatus == 'CONFIRMED';
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(confirmed ? Icons.check_circle : Icons.hourglass_top_rounded, color: confirmed ? EsokoColors.green : EsokoColors.amber, size: 56),
            const SizedBox(height: EsokoSpacing.s3),
            Text(confirmed ? 'Contribution confirmed' : 'Contribution declared', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: EsokoSpacing.s2),
            Text(
              confirmed
                  ? 'It has been added to the group balance.'
                  : "An officer will confirm it once they've verified the payment.",
              textAlign: TextAlign.center,
              style: TextStyle(color: EsokoColors.text2),
            ),
            const SizedBox(height: EsokoSpacing.s5),
            FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
          ],
        );
      case _Stage.failed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: EsokoColors.red, size: 48),
            const SizedBox(height: EsokoSpacing.s3),
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s4),
            OutlinedButton(onPressed: () => setState(() => _stage = _Stage.form), child: const Text('Try again')),
          ],
        );
    }
  }
}
