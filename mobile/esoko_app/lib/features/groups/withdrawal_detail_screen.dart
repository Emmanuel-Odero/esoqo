import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'group_models.dart';

final withdrawalDetailProvider = FutureProvider.autoDispose.family<WithdrawalRow, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/withdrawals/$id');
  return WithdrawalRow.fromJson(res);
});

/// POST /v1/withdrawals/:id/sign — a live PIN re-entry, never a client
/// "already verified" flag (see SignWithdrawal's own comment on the Go
/// side). One REJECT halts immediately; an APPROVE just adds a
/// signature and waits for the standby window + threshold, both.
class WithdrawalDetailScreen extends ConsumerStatefulWidget {
  const WithdrawalDetailScreen({super.key, required this.withdrawalId});
  final String withdrawalId;

  @override
  ConsumerState<WithdrawalDetailScreen> createState() => _WithdrawalDetailScreenState();
}

class _WithdrawalDetailScreenState extends ConsumerState<WithdrawalDetailScreen> {
  bool _signing = false;
  String? _error;

  Future<void> _sign(String decision) async {
    final pin = await showPinPromptDialog(
      context,
      title: decision == 'APPROVE' ? 'Approve withdrawal' : 'Reject withdrawal',
      message: 'Enter your PIN to sign this decision.',
    );
    if (pin == null || pin.isEmpty) return;

    setState(() {
      _signing = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/withdrawals/${widget.withdrawalId}/sign', {'decision': decision, 'pin': pin});
      ref.invalidate(withdrawalDetailProvider(widget.withdrawalId));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _signing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final withdrawal = ref.watch(withdrawalDetailProvider(widget.withdrawalId));
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Withdrawal'),
      body: EsokoAsyncView(
        value: withdrawal,
        onRetry: () => ref.invalidate(withdrawalDetailProvider(widget.withdrawalId)),
        data: (context, w) => ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s5),
          children: [
            Container(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              decoration: BoxDecoration(color: _statusTint(w.status), borderRadius: BorderRadius.circular(EsokoRadius.lg)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('KES ${w.amountKes}', style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: _statusColor(w.status))),
                  const SizedBox(height: 4),
                  Text(w.purpose),
                  Text('to ${w.payeeName}', style: TextStyle(color: EsokoColors.text2)),
                  const SizedBox(height: EsokoSpacing.s3),
                  Chip(label: Text(w.status), backgroundColor: Colors.white),
                ],
              ),
            ),
            const SizedBox(height: EsokoSpacing.s5),
            if (w.status == 'PENDING_SIGNATURES') ...[
              Row(
                children: [
                  Icon(Icons.schedule, size: 16, color: EsokoColors.text2),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Can execute from ${_formatDate(w.standbyOpensAt)}, once ${w.requiredSigners} signer${w.requiredSigners == 1 ? '' : 's'} approve.',
                      style: TextStyle(color: EsokoColors.text2, fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: EsokoSpacing.s4),
            ],
            Text('${w.approveCount} of ${w.requiredSigners} signed', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: EsokoSpacing.s2),
            for (final s in w.signatures) _SignatureTile(signature: s),
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              Text(_error!, style: TextStyle(color: EsokoColors.red)),
            ],
            if (w.canSign) ...[
              const SizedBox(height: EsokoSpacing.s5),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _signing ? null : () => _sign('REJECT'),
                      style: OutlinedButton.styleFrom(foregroundColor: EsokoColors.red),
                      child: const Text('Reject'),
                    ),
                  ),
                  const SizedBox(width: EsokoSpacing.s3),
                  Expanded(
                    child: FilledButton(
                      onPressed: _signing ? null : () => _sign('APPROVE'),
                      child: _signing
                          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Approve'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _statusColor(String status) => switch (status) {
        'EXECUTED' => EsokoColors.green,
        'REJECTED' || 'EXPIRED' => EsokoColors.red,
        _ => EsokoColors.amber,
      };
  Color _statusTint(String status) => switch (status) {
        'EXECUTED' => EsokoColors.greenTint,
        'REJECTED' || 'EXPIRED' => EsokoColors.redTint,
        _ => EsokoColors.amberTint,
      };
  String _formatDate(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

class _SignatureTile extends StatelessWidget {
  const _SignatureTile({required this.signature});
  final SignatureRow signature;

  @override
  Widget build(BuildContext context) {
    final approved = signature.decision == 'APPROVE';
    return Card(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: ListTile(
        leading: Icon(approved ? Icons.check_circle_outline : Icons.cancel_outlined, color: approved ? EsokoColors.green : EsokoColors.red),
        title: Text(signature.signerName),
        subtitle: Text(signature.decision + (signature.valid ? '' : ' · signature mismatch')),
      ),
    );
  }
}
