import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'groups_repository.dart';

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
      final status = await ref
          .read(groupsRepositoryProvider)
          .contribute(
            groupId: widget.groupId,
            amountKes: amount,
            method: _method,
          );
      setState(() {
        _resultStatus = status;
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
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Contribute'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s6),
              // Same contract as the other money flows: the stage
              // machine cross-fades, money never visually jumps.
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsoqoMotion.medium,
                switchInCurve: EsoqoMotion.easeOut,
                switchOutCurve: EsoqoMotion.easeOut,
                child: KeyedSubtree(key: ValueKey(_stage), child: _body()),
              ),
            ),
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
            EsoqoField.amount(
              controller: _amountController,
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: EsoqoSpacing.s4),
            EsoqoSegmentedToggle<String>(
              selected: _method,
              onChanged: (m) {
                EsoqoHaptics.tap();
                setState(() => _method = m);
              },
              options: const [('MPESA', 'M-Pesa'), ('CASH_TO_AGENT', 'Cash')],
            ),
            if (_method != 'MPESA')
              const Padding(
                padding: EdgeInsets.only(top: EsoqoSpacing.s3),
                child: EsoqoInlineNotice(
                  icon: EsoqoIconName.clock,
                  message: "This records your claim — it won't count toward the group balance until an officer confirms the cash is actually in hand.",
                ),
              ),
            if (_error != null) EsoqoFormError(message: _error!),
            const SizedBox(height: EsoqoSpacing.s5),
            EsoqoButton.primary(
              expand: false,
              label: _method == 'MPESA'
                  ? 'Pay with M-Pesa'
                  : 'Declare contribution',
              esoqoIcon: _method == 'MPESA'
                  ? EsoqoIconName.lock
                  : EsoqoIconName.document,
              onPressed: _submit,
            ),
          ],
        );
      case _Stage.submitting:
        return const Padding(
          padding: EdgeInsets.all(EsoqoSpacing.s6),
          child: EsoqoSkeletonCard(leading: false),
        );
      case _Stage.done:
        final confirmed = _resultStatus == 'CONFIRMED';
        return EsoqoResultView.success(
          title: confirmed ? 'Contribution confirmed' : 'Contribution declared',
          message: confirmed
              ? 'It has been added to the group balance.'
              : "An officer will confirm it once they've verified the payment.",
          successIcon: confirmed
              ? Icons.check_rounded
              : Icons.hourglass_top_rounded,
          badgeColor: confirmed ? EsoqoColors.green : EsoqoColors.amber,
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).pop(),
        );
      case _Stage.failed:
        return EsoqoResultView.failure(
          errorMessage: _error ?? 'Something went wrong',
          primaryLabel: 'Try again',
          onPrimary: () => setState(() => _stage = _Stage.form),
        );
    }
  }
}
