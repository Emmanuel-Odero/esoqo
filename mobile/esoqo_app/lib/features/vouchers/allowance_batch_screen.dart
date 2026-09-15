import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'vouchers_repository.dart';

final voucherBatchesProvider = FutureProvider.autoDispose<List<VoucherBatchRow>>(
  (ref) => ref.watch(vouchersRepositoryProvider).myVoucherBatches(),
);

const _allowancePurposes = [
  ('FUEL', 'Fuel'),
  ('TRAVEL', 'Travel / commute'),
];

/// Employer-owner-scoped batch-issue: one M-Pesa payment, N employees
/// each getting their own FUEL/TRAVEL allowance voucher — see
/// dbx.IssueAllowanceVoucherBatch. Enterprise-owner-scoped by the same
/// "self-funded only" rule the Go side enforces (no capability
/// plumbing needed — the signed-in party is always the one paying).
class AllowanceBatchScreen extends ConsumerStatefulWidget {
  const AllowanceBatchScreen({super.key});

  @override
  ConsumerState<AllowanceBatchScreen> createState() =>
      _AllowanceBatchScreenState();
}

class _AllowanceBatchScreenState extends ConsumerState<AllowanceBatchScreen> {
  final _labelController = TextEditingController();
  final _amountController = TextEditingController();
  final _employerMsisdnController = TextEditingController();
  final _employeeMsisdnController = TextEditingController();
  final _employeeMsisdns = <String>[];
  String _purpose = 'FUEL';
  bool _busy = false;
  String? _error;
  String? _resultStatus;

  @override
  void initState() {
    super.initState();
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _employerMsisdnController.text = auth.profile.msisdn ?? '';
    }
  }

  @override
  void dispose() {
    _labelController.dispose();
    _amountController.dispose();
    _employerMsisdnController.dispose();
    _employeeMsisdnController.dispose();
    super.dispose();
  }

  void _addEmployee() {
    final msisdn = _employeeMsisdnController.text.trim();
    if (msisdn.isEmpty || _employeeMsisdns.contains(msisdn)) return;
    setState(() {
      _employeeMsisdns.add(msisdn);
      _employeeMsisdnController.clear();
    });
  }

  Future<void> _issue() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter an amount per employee above zero.');
      return;
    }
    if (_employeeMsisdns.isEmpty) {
      setState(() => _error = 'Add at least one employee phone number.');
      return;
    }
    if (_employerMsisdnController.text.trim().isEmpty) {
      setState(() => _error = 'Enter the phone number to pay from.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _resultStatus = null;
    });
    try {
      final result = await ref.read(vouchersRepositoryProvider).issueAllowanceBatch(
            purpose: _purpose,
            label: _labelController.text.trim(),
            amountPerEmployeeKes: amount,
            employeeMsisdns: _employeeMsisdns,
            employerMsisdn: _employerMsisdnController.text.trim(),
          );
      setState(() {
        _resultStatus = result.paid
            ? 'Issued to ${_employeeMsisdns.length} employees.'
            : 'Payment started — complete the M-Pesa prompt on your phone.';
        _employeeMsisdns.clear();
        _labelController.clear();
        _amountController.clear();
      });
      ref.invalidate(voucherBatchesProvider);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final batches = ref.watch(voucherBatchesProvider);
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Employee allowances'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              children: [
                const EsoqoPageLead(
                  'One payment, one voucher per employee — spendable on fare or fuel, nowhere else.',
                ),
                const SizedBox(height: EsoqoSpacing.s4),
                EsoqoDropdown<String>(
                  label: 'Purpose',
                  initialValue: _purpose,
                  items: [
                    for (final p in _allowancePurposes)
                      DropdownMenuItem(value: p.$1, child: Text(p.$2)),
                  ],
                  onChanged: (v) => setState(() => _purpose = v ?? _purpose),
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoField.text(
                  controller: _labelController,
                  label: 'Label (optional)',
                  hint: 'e.g. September fuel allowance',
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoField.amount(
                  controller: _amountController,
                  label: 'Amount per employee',
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoField.phone(
                  controller: _employerMsisdnController,
                  label: 'Pay from (your M-Pesa number)',
                ),
                const SizedBox(height: EsoqoSpacing.s4),
                EsoqoSubHeader('Employees'),
                const SizedBox(height: EsoqoSpacing.s2),
                Row(
                  children: [
                    Expanded(
                      child: EsoqoField.phone(
                        controller: _employeeMsisdnController,
                        label: 'Employee phone number',
                        onSubmitted: (_) => _addEmployee(),
                      ),
                    ),
                    const SizedBox(width: EsoqoSpacing.s2),
                    IconButton.filled(
                      onPressed: _addEmployee,
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
                if (_employeeMsisdns.isNotEmpty) ...[
                  const SizedBox(height: EsoqoSpacing.s2),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final msisdn in _employeeMsisdns)
                        Chip(
                          label: Text(msisdn),
                          onDeleted: () =>
                              setState(() => _employeeMsisdns.remove(msisdn)),
                        ),
                    ],
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoFormError(message: _error!),
                ],
                if (_resultStatus != null) ...[
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoInlineNotice(
                    message: _resultStatus!,
                    icon: EsoqoIconName.checkCircle,
                    color: EsoqoColors.blue,
                  ),
                ],
                const SizedBox(height: EsoqoSpacing.s4),
                EsoqoButton.primary(
                  expand: false,
                  label: 'Issue allowance batch',
                  loading: _busy,
                  onPressed: _issue,
                ),
                const SizedBox(height: EsoqoSpacing.s7),
                EsoqoSubHeader('Past batches'),
                const SizedBox(height: EsoqoSpacing.s2),
                batches.when(
                  data: (list) => list.isEmpty
                      ? const EsoqoEmptyState(
                          icon: Icons.local_gas_station_outlined,
                          message: 'No batches issued yet.',
                        )
                      : Column(
                          children: [
                            for (final b in list)
                              EsoqoListTile(
                                title: b.label,
                                subtitle:
                                    '${b.purpose} · ${b.issuedCount}/${b.employeeCount} issued · KES ${b.amountPerEmployeeKes} each',
                                icon: Icons.local_gas_station_outlined,
                              ),
                          ],
                        ),
                  loading: () => const EsoqoSkeletonCard(leading: false),
                  error: (_, _) => const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
