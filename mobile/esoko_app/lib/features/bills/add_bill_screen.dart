import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'bill_models.dart';

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
      final api = ref.read(apiClientProvider);
      await api.post('/v1/me/bills', {
        'label': _labelController.text.trim(),
        'category': _category,
        if (_accountRefController.text.trim().isNotEmpty) 'accountRef': _accountRefController.text.trim(),
        if (_amountController.text.trim().isNotEmpty) 'amountKes': double.tryParse(_amountController.text.trim()),
        'cycle': _cycle,
        'nextDueAt': _nextDueAt.toUtc().toIso8601String(),
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
      appBar: AppBar(title: const Text('Add a bill')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(EsokoSpacing.s6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _labelController,
                    decoration: const InputDecoration(labelText: 'Name', hintText: 'e.g. KPLC — home'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: const InputDecoration(labelText: 'Category'),
                    items: [for (final c in billCategories) DropdownMenuItem(value: c.$1, child: Text(c.$2))],
                    onChanged: (v) => setState(() => _category = v ?? _category),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _accountRefController,
                    decoration: const InputDecoration(labelText: 'Account / meter number (optional)'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  TextField(
                    controller: _amountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Usual amount, KES (optional)', hintText: 'Leave blank if it varies'),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  DropdownButtonFormField<String>(
                    initialValue: _cycle,
                    decoration: const InputDecoration(labelText: 'Repeats'),
                    items: [for (final c in billCycles) DropdownMenuItem(value: c.$1, child: Text(c.$2))],
                    onChanged: (v) => setState(() => _cycle = v ?? _cycle),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Next due date'),
                    subtitle: Text('${_nextDueAt.year}-${_nextDueAt.month.toString().padLeft(2, '0')}-${_nextDueAt.day.toString().padLeft(2, '0')}'),
                    trailing: const Icon(Icons.calendar_today_outlined),
                    onTap: _pickDate,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: EsokoSpacing.s2),
                    Text(_error!, style: TextStyle(color: EsokoColors.red)),
                  ],
                  const SizedBox(height: EsokoSpacing.s5),
                  FilledButton(
                    onPressed: _loading ? null : _save,
                    child: _loading
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Save bill'),
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
