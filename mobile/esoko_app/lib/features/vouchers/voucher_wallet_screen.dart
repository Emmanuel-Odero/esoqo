import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'allowance_batch_screen.dart';
import 'voucher_models.dart';
import 'voucher_providers.dart';
import 'vouchers_repository.dart';

/// Wallet: loyalty balance, voucher cards, create + top-up.
/// Thin UI — every rule (purpose lock, 10pts=KES1, 10% earn) lives in Go.
class VoucherWalletScreen extends ConsumerStatefulWidget {
  const VoucherWalletScreen({super.key});

  @override
  ConsumerState<VoucherWalletScreen> createState() =>
      _VoucherWalletScreenState();
}

class _VoucherWalletScreenState extends ConsumerState<VoucherWalletScreen> {
  final _label = TextEditingController();
  final _amount = TextEditingController();
  final _recipient = TextEditingController();
  String _purpose = 'FARE';
  String _loadMethod = 'MPESA_STK';
  String? _msg;
  bool _loading = false;

  @override
  void dispose() {
    _label.dispose();
    _amount.dispose();
    _recipient.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    setState(() {
      _loading = true;
      _msg = null;
    });
    EsokoHaptics.tap();
    try {
      await ref
          .read(vouchersRepositoryProvider)
          .createVoucher(
            label: _label.text.trim().isEmpty
                ? '$_purpose voucher'
                : _label.text.trim(),
            purpose: _purpose,
            amountKes: double.tryParse(_amount.text.trim()) ?? 0,
            loadMethod: _loadMethod,
            recipientMsisdn: _recipient.text.trim(),
          );
      if (mounted) {
        setState(
          () => _msg = 'Voucher created — complete M-Pesa prompt if asked.',
        );
      }
      ref.invalidate(myVouchersProvider);
      ref.invalidate(myLoyaltyProvider);
    } on ApiException catch (e) {
      if (mounted) setState(() => _msg = e.message);
    } catch (e) {
      if (mounted) {
        setState(() => _msg = 'Could not reach Esoko. Check your connection.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final loyalty = ref.watch(myLoyaltyProvider);
    final vouchers = ref.watch(myVouchersProvider);
    return Scaffold(
      appBar: EsokoAppBar(
        title: 'Vouchers',
        actions: [
          IconButton(
            icon: const Icon(Icons.groups_outlined),
            tooltip: 'Employee allowances',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const AllowanceBatchScreen()),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              children: [
                EsokoAsyncView(
                  value: loyalty,
                  isEmpty: (_) => false,
                  emptyMessage: '',
                  emptyIcon: Icons.stars_outlined,
                  onRetry: () => ref.invalidate(myLoyaltyProvider),
                  data: (context, m) => EsokoCard(
                    padding: const EdgeInsets.all(EsokoSpacing.s4),
                    child: Text(
                      'Loyalty: ${m.totalPoints} pts ≈ KES ${m.kesEquiv}\n10 pts = KES 1 · earn 10% of every spend.',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                ),
                const SizedBox(height: EsokoSpacing.s4),
                const EsokoSectionHeader(
                  title: 'New voucher',
                  subtitle: 'Purpose-locked. Gift via phone number.',
                ),
                EsokoDropdown<String>(
                  label: 'Purpose',
                  initialValue: _purpose,
                  items: const ['FARE', 'RENT', 'SHOPPING', 'GENERAL']
                      .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                      .toList(),
                  onChanged: (v) => setState(() => _purpose = v ?? 'FARE'),
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _label,
                  label: 'Label',
                  hint: 'e.g. School run',
                  icon: Icons.label_outlined,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _amount,
                  label: 'Amount KES',
                  hint: 'e.g. 200',
                  icon: Icons.payments_outlined,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoFormField(
                  controller: _recipient,
                  label: 'Gift to (optional)',
                  hint: '+254…',
                  icon: Icons.card_giftcard_outlined,
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoDropdown<String>(
                  label: 'Load with',
                  initialValue: _loadMethod,
                  items: const ['MPESA_STK', 'LOYALTY']
                      .map(
                        (p) => DropdownMenuItem(
                          value: p,
                          child: Text(
                            p == 'LOYALTY' ? 'Pay with loyalty' : 'M-Pesa',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (v) =>
                      setState(() => _loadMethod = v ?? 'MPESA_STK'),
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoLoadingButton(
                  label: 'Create voucher',
                  icon: Icons.add_circle_outline,
                  loading: _loading,
                  onPressed: _create,
                ),
                if (_msg != null) ...[
                  const SizedBox(height: EsokoSpacing.s2),
                  Text(_msg!, style: const TextStyle(color: EsokoColors.text2)),
                ],
                const SizedBox(height: EsokoSpacing.s5),
                const EsokoSectionHeader(
                  title: 'My cards',
                  subtitle: 'Show QR to pay or be verified.',
                ),
                EsokoAsyncView(
                  value: vouchers,
                  isEmpty: (l) => l.isEmpty,
                  emptyMessage: 'No vouchers yet.',
                  emptyIcon: Icons.wallet_outlined,
                  onRetry: () => ref.invalidate(myVouchersProvider),
                  data: (context, list) => Column(
                    children: [
                      for (var i = 0; i < list.length; i++)
                        EsokoStagger(index: i, child: _card(context, list[i])),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _card(BuildContext context, VoucherCard v) {
    return EsokoCard(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        leading: const Icon(Icons.wallet_outlined),
        title: Text('${v.label} · ${v.purpose}'),
        subtitle: Text(
          '${v.balancePoints} pts ≈ KES ${v.balanceKes} · ${v.shortCode} · ${v.status}',
        ),
        children: [
          if (v.qrPayload.isNotEmpty) QrImageView(data: v.qrPayload, size: 160),
          SelectableText(v.shortCode),
        ],
      ),
    );
  }
}
