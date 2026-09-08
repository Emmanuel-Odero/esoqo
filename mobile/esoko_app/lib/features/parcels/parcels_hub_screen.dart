import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'book_parcel_screen.dart';
import 'parcel_models.dart';
import 'parcel_status_screen.dart';
import 'parcels_repository.dart';

final myParcelsProvider = FutureProvider.autoDispose<List<ParcelRow>>(
  (ref) => ref.watch(parcelsRepositoryProvider).myParcels(),
);

final heldParcelsProvider = FutureProvider.autoDispose<List<ParcelRow>>(
  (ref) => ref.watch(parcelsRepositoryProvider).heldParcels(),
);

/// Two tabs, one screen: "Sent" (what I'm shipping, with the delivery
/// code to pass on) and "Holding" (what's currently in my custody as a
/// driver/handler — the scoped-session-shaped screen Phases 2/6/7 each
/// have their own version of). Accepting a new parcel is a code
/// entry here, not the universal scanner — a handler's whole job is
/// custody transfer, one dedicated action, not routed through the
/// general-purpose scan-and-dispatch screen.
class ParcelsHubScreen extends ConsumerStatefulWidget {
  const ParcelsHubScreen({super.key});

  @override
  ConsumerState<ParcelsHubScreen> createState() => _ParcelsHubScreenState();
}

class _ParcelsHubScreenState extends ConsumerState<ParcelsHubScreen> {
  int _tab = 0;
  final _acceptCodeController = TextEditingController();
  bool _acceptBusy = false;

  @override
  void dispose() {
    _acceptCodeController.dispose();
    super.dispose();
  }

  void _refreshAll() {
    ref.invalidate(myParcelsProvider);
    ref.invalidate(heldParcelsProvider);
  }

  Future<void> _acceptParcel() async {
    final code = _acceptCodeController.text.trim();
    if (code.isEmpty || _acceptBusy) return;
    setState(() => _acceptBusy = true);
    try {
      await ref.read(parcelsRepositoryProvider).scanHandoff(code);
      _acceptCodeController.clear();
      ref.invalidate(heldParcelsProvider);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _acceptBusy = false);
    }
  }

  Future<void> _deliverParcel(ParcelRow row) async {
    final codeController = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirm delivery'),
        content: EsokoFormField(
          controller: codeController,
          label: 'Delivery code',
          hint: 'From the sender',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(codeController.text.trim()),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (code == null || code.isEmpty || !mounted) return;
    try {
      await ref
          .read(parcelsRepositoryProvider)
          .deliver(code: row.code, deliveryCode: code);
      ref.invalidate(heldParcelsProvider);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final sent = ref.watch(myParcelsProvider);
    final held = ref.watch(heldParcelsProvider);
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Parcels'),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EsokoSpacing.s4,
                EsokoSpacing.s3,
                EsokoSpacing.s4,
                0,
              ),
              child: SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 0, label: Text('Sent')),
                  ButtonSegment(value: 1, label: Text('Holding')),
                ],
                selected: {_tab},
                onSelectionChanged: (s) => setState(() => _tab = s.first),
              ),
            ),
            Expanded(
              child: IndexedStack(
                index: _tab,
                children: [
                  RefreshIndicator(
                    onRefresh: () async => ref.invalidate(myParcelsProvider),
                    child: EsokoAsyncView(
                      value: sent,
                      isEmpty: (l) => l.isEmpty,
                      emptyMessage: 'No parcels sent yet.',
                      emptyIcon: Icons.local_shipping_outlined,
                      onRetry: () => ref.invalidate(myParcelsProvider),
                      data: (context, list) => ListView.separated(
                        padding: const EdgeInsets.all(EsokoSpacing.s4),
                        itemCount: list.length,
                        separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
                        itemBuilder: (context, i) {
                          final p = list[i];
                          return EsokoListTile(
                            title: '${p.originLabel} → ${p.destinationLabel}',
                            subtitle: '${p.code} · ${p.status}',
                            icon: Icons.local_shipping_outlined,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => ParcelStatusScreen(
                                  code: p.code,
                                  deliveryCode: p.deliveryCode,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(EsokoSpacing.s4),
                        child: Row(
                          children: [
                            Expanded(
                              child: EsokoFormField(
                                controller: _acceptCodeController,
                                label: 'Accept a parcel',
                                hint: 'PKG-XXXXXXX',
                                icon: Icons.qr_code_2_outlined,
                                textInputAction: TextInputAction.go,
                                onSubmitted: (_) => _acceptParcel(),
                              ),
                            ),
                            const SizedBox(width: EsokoSpacing.s2),
                            EsokoLoadingButton(
                              label: 'Accept',
                              loading: _acceptBusy,
                              onPressed: _acceptParcel,
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: RefreshIndicator(
                          onRefresh: () async => ref.invalidate(heldParcelsProvider),
                          child: EsokoAsyncView(
                            value: held,
                            isEmpty: (l) => l.isEmpty,
                            emptyMessage: 'Not holding any parcels right now.',
                            emptyIcon: Icons.inventory_2_outlined,
                            onRetry: () => ref.invalidate(heldParcelsProvider),
                            data: (context, list) => ListView.separated(
                              padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s4),
                              itemCount: list.length,
                              separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
                              itemBuilder: (context, i) {
                                final p = list[i];
                                return EsokoListTile(
                                  title: '${p.originLabel} → ${p.destinationLabel}',
                                  subtitle: '${p.code} · to ${p.receiverName}',
                                  icon: Icons.inventory_2_outlined,
                                  trailing: TextButton(
                                    onPressed: () => _deliverParcel(p),
                                    child: const Text('Deliver'),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final code = await Navigator.of(context).push<String>(
            MaterialPageRoute(builder: (_) => const BookParcelScreen()),
          );
          if (code != null) {
            _refreshAll();
            if (!context.mounted) return;
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => ParcelStatusScreen(code: code),
              ),
            );
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('Send parcel'),
      ),
    );
  }
}
