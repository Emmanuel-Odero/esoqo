import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'group_models.dart';
import 'groups_repository.dart';

final withdrawalDetailProvider = FutureProvider.autoDispose
    .family<WithdrawalRow, String>(
      (ref, id) => ref.watch(groupsRepositoryProvider).withdrawal(id),
    );

/// POST /v1/withdrawals/:id/sign — a live PIN re-entry, never a client
/// "already verified" flag (see SignWithdrawal's own comment on the Go
/// side). One REJECT halts immediately; an APPROVE just adds a
/// signature and waits for the standby window + threshold, both.
class WithdrawalDetailScreen extends ConsumerStatefulWidget {
  const WithdrawalDetailScreen({super.key, required this.withdrawalId});
  final String withdrawalId;

  @override
  ConsumerState<WithdrawalDetailScreen> createState() =>
      _WithdrawalDetailScreenState();
}

class _WithdrawalDetailScreenState
    extends ConsumerState<WithdrawalDetailScreen> {
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
    EsokoHaptics.tap();
    try {
      await ref
          .read(groupsRepositoryProvider)
          .signWithdrawal(
            withdrawalId: widget.withdrawalId,
            decision: decision,
            pin: pin,
          );
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
        onRetry: () =>
            ref.invalidate(withdrawalDetailProvider(widget.withdrawalId)),
        data: (context, w) {
          final scheme = Theme.of(context).colorScheme;
          // Theme-derived, not a fixed EsokoColors.text2 — this screen's
          // body sits directly on the scaffold background, which is
          // EsokoColors.paper in light mode and darkSurface in dark; a
          // hardcoded light-tuned grey loses contrast on the latter.
          final muted = Theme.of(context).textTheme.bodySmall?.color;
          final (statusColor, statusIcon) = switch (w.status) {
            'EXECUTED' => (scheme.primary, EsokoIconName.checkCircle),
            'REJECTED' || 'EXPIRED' => (scheme.error, EsokoIconName.ban),
            _ => (EsokoColors.amber, EsokoIconName.clock),
          };
          final quorumDone = w.requiredSigners == 0
              ? 1.0
              : (w.approveCount / w.requiredSigners).clamp(0.0, 1.0);
          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView(
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                children: [
                  EsokoAmountHeader(
                    label: 'Withdrawal',
                    amountKes: w.amountKes,
                    detail: '${w.purpose}\nto ${w.payeeName}',
                    trailing: EsokoStatusPill(
                      label: w.status,
                      color: statusColor,
                      esokoIcon: statusIcon,
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s5),
                  if (w.status == 'PENDING_SIGNATURES') ...[
                    Row(
                      children: [
                        EsokoIcon(EsokoIconName.clock, size: 16, color: muted),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Can execute from ${_formatDate(w.standbyOpensAt)}, once ${w.requiredSigners} signer${w.requiredSigners == 1 ? '' : 's'} approve.',
                            style: TextStyle(color: muted, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: EsokoSpacing.s4),
                  ],
                  Row(
                    children: [
                      Text(
                        '${w.approveCount} of ${w.requiredSigners} signed',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: EsokoSpacing.s2),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(EsokoRadius.pill),
                    child: LinearProgressIndicator(
                      value: quorumDone,
                      minHeight: 6,
                      backgroundColor: EsokoColors.line,
                      valueColor: AlwaysStoppedAnimation(statusColor),
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  for (var i = 0; i < w.signatures.length; i++)
                    EsokoStagger(
                      index: i,
                      child: _SignatureTile(signature: w.signatures[i]),
                    ),
                  if (_error != null) EsokoFormError(message: _error!),
                  if (w.canSign) ...[
                    const SizedBox(height: EsokoSpacing.s5),
                    Row(
                      children: [
                        Expanded(
                          // Gated by the PIN prompt _sign() opens, so the
                          // button must not ask a second time.
                          child: EsokoButton.destructiveGated(
                            label: 'Reject',
                            loading: _signing,
                            onPressed: () => _sign('REJECT'),
                          ),
                        ),
                        const SizedBox(width: EsokoSpacing.s3),
                        Expanded(
                          // Institutional, not primary: signing this is
                          // an act of the group, not of you — the
                          // example EsokoButtonRole itself cites.
                          child: EsokoButton.institutional(
                            label: 'Approve',
                            loading: _signing,
                            onPressed: () => _sign('APPROVE'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

class _SignatureTile extends StatelessWidget {
  const _SignatureTile({required this.signature});
  final SignatureRow signature;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final approved = signature.decision == 'APPROVE';
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: signature.signerName,
        subtitle:
            signature.decision +
            (signature.valid ? '' : ' · signature mismatch'),
        icon: approved ? Icons.check_circle_outline : Icons.cancel_outlined,
        iconColor: approved ? scheme.primary : scheme.error,
      ),
    );
  }
}
