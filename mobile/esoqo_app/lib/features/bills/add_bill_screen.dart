import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'bill_models.dart';
import 'bills_repository.dart';

class AddBillScreen extends ConsumerStatefulWidget {
  const AddBillScreen({super.key});

  @override
  ConsumerState<AddBillScreen> createState() => _AddBillScreenState();
}

class _AddBillScreenState extends ConsumerState<AddBillScreen> {
  final _labelController = TextEditingController();
  final _accountRefController = TextEditingController();
  final _amountController = TextEditingController();
  final _targetController = TextEditingController();
  String _category = 'ELECTRICITY';
  String _cycle = 'MONTHLY';
  DateTime _nextDueAt = DateTime.now().add(const Duration(days: 7));
  bool _loading = false;
  String? _error;
  // Off by default: funding is an opt-in step, not the norm — most
  // bills stay plain track-and-remind, per the Bill model's own
  // "nothing here moves money" default.
  bool _fundingEnabled = false;
  bool _autoPayEnabled = false;

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _nextDueAt,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
    );
    if (picked != null) setState(() => _nextDueAt = picked);
  }

  Future<void> _save() async {
    if (_labelController.text.trim().isEmpty) {
      setState(() => _error = 'Give this bill a name');
      return;
    }
    final target = double.tryParse(_targetController.text.trim());
    if (_fundingEnabled && (target == null || target <= 0)) {
      setState(() => _error = 'Enter how much you\'re raising toward');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(billsRepositoryProvider);
      final billId = await repo.addBill(
        label: _labelController.text.trim(),
        category: _category,
        accountRef: _accountRefController.text.trim(),
        amountKes: double.tryParse(_amountController.text.trim()),
        cycle: _cycle,
        nextDueAt: _nextDueAt,
      );
      if (_fundingEnabled && target != null) {
        await repo.setFundingTarget(
          id: billId,
          targetKes: target,
          autoPayEnabled: _autoPayEnabled,
        );
      }
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
      appBar: const EsoqoAppBar(title: 'Add a bill'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsoqoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  EsoqoField.text(
                    controller: _labelController,
                    label: 'Name',
                    hint: 'e.g. KPLC — home',
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoDropdown<String>(
                    label: 'Category',
                    initialValue: _category,
                    items: [
                      for (final c in billCategories)
                        DropdownMenuItem(value: c.$1, child: Text(c.$2)),
                    ],
                    onChanged: (v) =>
                        setState(() => _category = v ?? _category),
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoField.text(
                    controller: _accountRefController,
                    label: 'Account / meter number (optional)',
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoField.amount(
                    controller: _amountController,
                    label: 'Usual amount (optional)',
                    hint: 'Leave blank if it varies',
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  EsoqoDropdown<String>(
                    label: 'Repeats',
                    initialValue: _cycle,
                    items: [
                      for (final c in billCycles)
                        DropdownMenuItem(value: c.$1, child: Text(c.$2)),
                    ],
                    onChanged: (v) => setState(() => _cycle = v ?? _cycle),
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Next due date'),
                    subtitle: Text(
                      '${_nextDueAt.year}-${_nextDueAt.month.toString().padLeft(2, '0')}-${_nextDueAt.day.toString().padLeft(2, '0')}',
                    ),
                    trailing: const Icon(Icons.calendar_today_outlined),
                    onTap: _pickDate,
                  ),
                  const SizedBox(height: EsoqoSpacing.s3),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Let family or friends help pay'),
                    subtitle: const Text(
                      'A shareable progress bar — chip-ins are real M-Pesa payments.',
                    ),
                    value: _fundingEnabled,
                    onChanged: (v) => setState(() => _fundingEnabled = v),
                  ),
                  if (_fundingEnabled) ...[
                    const SizedBox(height: EsoqoSpacing.s3),
                    EsoqoField.amount(
                      controller: _targetController,
                      label: 'Target amount',
                    ),
                    const SizedBox(height: EsoqoSpacing.s2),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Auto mark paid once fully funded'),
                      value: _autoPayEnabled,
                      onChanged: (v) => setState(() => _autoPayEnabled = v),
                    ),
                  ],
                  if (_error != null) EsoqoFormError(message: _error!),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoButton.primary(
                    expand: false,
                    label: 'Save bill',
                    loading: _loading,
                    onPressed: _save,
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
