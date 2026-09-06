import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
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
  String _category = 'ELECTRICITY';
  String _cycle = 'MONTHLY';
  DateTime _nextDueAt = DateTime.now().add(const Duration(days: 7));
  bool _loading = false;
  String? _error;

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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(billsRepositoryProvider)
          .addBill(
            label: _labelController.text.trim(),
            category: _category,
            accountRef: _accountRefController.text.trim(),
            amountKes: double.tryParse(_amountController.text.trim()),
            cycle: _cycle,
            nextDueAt: _nextDueAt,
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
      appBar: const EsokoAppBar(title: 'Add a bill'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  EsokoFormField(
                    controller: _labelController,
                    label: 'Name',
                    hint: 'e.g. KPLC — home',
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoDropdown<String>(
                    label: 'Category',
                    initialValue: _category,
                    items: [
                      for (final c in billCategories)
                        DropdownMenuItem(value: c.$1, child: Text(c.$2)),
                    ],
                    onChanged: (v) =>
                        setState(() => _category = v ?? _category),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormField(
                    controller: _accountRefController,
                    label: 'Account / meter number (optional)',
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormField(
                    controller: _amountController,
                    label: 'Usual amount, KES (optional)',
                    hint: 'Leave blank if it varies',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    textInputAction: TextInputAction.done,
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoDropdown<String>(
                    label: 'Repeats',
                    initialValue: _cycle,
                    items: [
                      for (final c in billCycles)
                        DropdownMenuItem(value: c.$1, child: Text(c.$2)),
                    ],
                    onChanged: (v) => setState(() => _cycle = v ?? _cycle),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Next due date'),
                    subtitle: Text(
                      '${_nextDueAt.year}-${_nextDueAt.month.toString().padLeft(2, '0')}-${_nextDueAt.day.toString().padLeft(2, '0')}',
                    ),
                    trailing: const Icon(Icons.calendar_today_outlined),
                    onTap: _pickDate,
                  ),
                  if (_error != null) EsokoFormError(message: _error!),
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoLoadingButton(
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
