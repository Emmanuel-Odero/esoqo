import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/fare_pay_screen.dart';
import '../fleet/verify_fare_screen.dart';
import '../parcels/parcel_status_screen.dart';
import '../shopping/product_detail_screen.dart';
import '../shopping/self_checkout_screen.dart';
import '../shopping/store_detail_screen.dart';
import '../vouchers/voucher_wallet_screen.dart';
import 'scan_repository.dart';

/// One scanner for every Esoko code. GET /v1/scan/resolve sniffs the
/// kind (trip, voucher, fare, product, store, table, ticket, order,
/// party, certificate, parcel) plus an `action` hint, and this screen
/// routes to the matching flow — matatu boarding, mall self-checkout
/// (shelf barcode → product → checkout), restaurant tables (menu +
/// table label), vouchers, fare receipts, event tickets, store pickup
/// codes, payment-id cards, printed certificates, and parcel tracking.
/// Thin UI: Go owns the dispatch, and crew-only details stay behind
/// the verify rule.
class UniversalScanScreen extends ConsumerStatefulWidget {
  const UniversalScanScreen({super.key});

  @override
  ConsumerState<UniversalScanScreen> createState() =>
      _UniversalScanScreenState();
}

class _UniversalScanScreenState extends ConsumerState<UniversalScanScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;
  ScanResolution? _result;

  /// When on, a scanned product joins the self-checkout basket instead
  /// of navigating to its product page — the "scanning should just be
  /// scanning" rule from the journey-map memo: a shopper walking a mall
  /// aisle scans one item after another without a screen change each
  /// time.
  bool _basketMode = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  bool get _canVerify {
    final auth = ref.read(authControllerProvider);
    return auth is AuthSignedIn && canVerifyFare(auth.profile);
  }

  void _route(BuildContext context, ScanResolution r) {
    if (r.kind == 'fare' && _canVerify) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const VerifyFareScreen()),
      );
      return;
    }
    if (r.isInlineResult) {
      setState(() => _result = r);
      return;
    }
    switch (r.kind) {
      case 'trip':
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => FarePayScreen(tripQrCode: _code.text.trim()),
          ),
        );
      case 'voucher':
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const VoucherWalletScreen()),
        );
      case 'product':
        final id = r.productId;
        if (id == null) {
          setState(() => _error = 'Could not read that product.');
        } else if (_basketMode) {
          if (r.storeSlug == null || r.productName == null || r.productPriceKes == null) {
            setState(() => _error = 'Could not read that product.');
          } else {
            ref.read(selfCheckoutBasketProvider.notifier).addScan(
                  storeSlug: r.storeSlug!,
                  storeName: r.storeName ?? 'This store',
                  productId: id,
                  name: r.productName!,
                  priceKes: r.productPriceKes!,
                );
          }
        } else {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (_) => ProductDetailScreen(productId: id),
            ),
          );
        }
      case 'store':
        final slug = r.storeSlug;
        if (slug == null) {
          setState(() => _error = 'Could not read that store.');
        } else {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (_) => StoreDetailScreen(slug: slug)),
          );
        }
      case 'table':
        final slug = r.storeSlug;
        if (slug == null) {
          setState(() => _error = 'Could not read that table.');
        } else {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (_) =>
                  StoreDetailScreen(slug: slug, tableLabel: r.tableLabel),
            ),
          );
        }
      case 'parcel':
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => ParcelStatusScreen(code: _code.text.trim()),
          ),
        );
      default:
        setState(
          () => _error =
              'Not an Esoko code — try a bus QR, shelf barcode, or table code.',
        );
    }
  }

  Future<void> _resolve(String raw) async {
    final code = raw.trim();
    if (code.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _result = null;
    });
    try {
      final r = await ref.read(scanRepositoryProvider).resolve(code);
      if (mounted) _route(context, r);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Scan'),
      bottomNavigationBar: _basketMode ? const SelfCheckoutBasketBar() : null,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              children: [
                const EsokoPageLead(
                  'Bus QR, shelf barcode, ticket, voucher, or payment card — one scanner.',
                ),
                const SizedBox(height: EsokoSpacing.s3),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Self-checkout basket'),
                  subtitle: const Text(
                    'Scan every item on the shelf, pay once at the end.',
                  ),
                  value: _basketMode,
                  onChanged: (v) => setState(() => _basketMode = v),
                ),
                const SizedBox(height: EsokoSpacing.s1),
                SizedBox(
                  height: 260,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(EsokoRadius.md),
                    child: MobileScanner(
                      onDetect: (cap) {
                        final v = cap.barcodes.firstOrNull?.rawValue;
                        if (v != null) _resolve(v);
                      },
                      errorBuilder: (context, error) {
                        final message =
                            error.errorDetails?.message ??
                            'Camera could not start (${error.errorCode.name}).';
                        debugPrint('esoko/scan: MobileScanner error: $message');
                        return Center(
                          child: Padding(
                            padding: const EdgeInsets.all(EsokoSpacing.s3),
                            child: EsokoFormError(message: message),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                const SizedBox(height: EsokoSpacing.s4),
                Row(
                  children: [
                    Expanded(
                      child: EsokoFormField(
                        controller: _code,
                        label: 'Code',
                        hint: 'BUS- · VCH- · TKT- · PKP- · ESK-',
                        icon: Icons.qr_code_2_outlined,
                        textInputAction: TextInputAction.go,
                        onSubmitted: _resolve,
                      ),
                    ),
                    const SizedBox(width: EsokoSpacing.s2),
                    EsokoLoadingButton(
                      label: 'Go',
                      loading: _busy,
                      onPressed: () => _resolve(_code.text),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  EsokoFormError(message: _error!),
                ],
                if (_result != null) ...[
                  const SizedBox(height: EsokoSpacing.s3),
                  _resultCard(context, _result!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _resultCard(BuildContext context, ScanResolution r) {
    switch (r.kind) {
      case 'fare':
        return _fareProof(context, r.fare!);
      case 'ticket':
        return _ticketCard(context, r.ticket!);
      case 'order':
        return _orderCard(context, r.order!);
      case 'party':
        return _partyCard(context, r.party!);
      case 'certificate':
        return _certCard(context, r.certificate!);
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _fareProof(BuildContext context, ScanFareProof f) {
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${f.status} · KES ${f.amountKes}',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Text('${f.orgName} · ${f.vehiclePlate}'),
          Text('${f.routeName} · ${f.ageMinutes} min ago'),
        ],
      ),
    );
  }

  Widget _ticketCard(BuildContext context, ScanTicketInfo t) {
    final valid = t.status == 'VALID';
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  t.className,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              _statusPill(
                context,
                valid ? 'Valid ticket' : t.status,
                ok: valid,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('${t.eventName} · ${t.orgName}'),
          if (t.seatLabel != null)
            Text(
              'Seat ${t.seatLabel}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            'KES ${t.priceKes}',
            style: TextStyle(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            t.code,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Gate check-in happens at the event.',
            style: TextStyle(
              color: Theme.of(context).textTheme.bodySmall?.color,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _orderCard(BuildContext context, ScanOrderInfo o) {
    final ready = o.status == 'READY_FOR_PICKUP';
    final done = o.status == 'FULFILLED';
    final label = ready
        ? 'Ready to collect'
        : done
        ? 'Collected'
        : o.status;
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Pickup order',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              _statusPill(context, label, ok: ready),
            ],
          ),
          const SizedBox(height: 4),
          Text('from ${o.storeName}'),
          Text(
            'KES ${o.totalKes}',
            style: TextStyle(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (o.readyAt != null && !done) ...[
            const SizedBox(height: EsokoSpacing.s2),
            Text('Ready ${_formatDate(o.readyAt!)}'),
          ],
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            o.pickupCode,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }

  Widget _partyCard(BuildContext context, ScanPartyInfo p) {
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              EsokoQuickActionIcon(
                icon: p.organisation
                    ? Icons.storefront_outlined
                    : Icons.person_outline,
              ),
              const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: Text(
                  p.displayName,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            p.esokoId,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: EsokoSpacing.s2),
          _statusPill(
            context,
            p.verified ? 'Verified on Esoko' : 'Not yet verified',
            ok: p.verified,
            warn: !p.verified,
          ),
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            'Payment card — paying them is a phone tap away.',
            style: TextStyle(
              color: Theme.of(context).textTheme.bodySmall?.color,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _certCard(BuildContext context, ScanCertInfo c) {
    if (!c.found) {
      return EsokoCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _statusPill(context, 'Not found', ok: false),
            const SizedBox(height: EsokoSpacing.s2),
            Text(
              'This is not a certificate Esoko issued.',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Type the code again, or check it at esoko.co.ke/verify.',
              style: TextStyle(
                color: Theme.of(context).textTheme.bodySmall?.color,
              ),
            ),
          ],
        ),
      );
    }
    final ok = c.status == 'valid';
    final warn = c.status == 'expiring';
    return EsokoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  c.claimType,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              _statusPill(context, c.status, ok: ok, warn: warn),
            ],
          ),
          const SizedBox(height: 4),
          Text('Held by ${c.holder}'),
          Text('Issued by ${c.issuer}'),
          if (c.issuedOn.isNotEmpty) ...[
            const SizedBox(height: EsokoSpacing.s1),
            Text('Issued ${_formatDate(c.issuedOn)}'),
          ],
          if (c.validUntil != null)
            Text('Valid until ${_formatDate(c.validUntil!)}'),
          const SizedBox(height: EsokoSpacing.s2),
          Text(
            'Verified directly from Esoko — no account needed.',
            style: TextStyle(
              color: Theme.of(context).textTheme.bodySmall?.color,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusPill(
    BuildContext context,
    String label, {
    required bool ok,
    bool warn = false,
  }) {
    final scheme = Theme.of(context).colorScheme;
    // EsokoColors.amber, not Material's generic Colors.amber/orange —
    // brand colour, and one that (like scheme.primary/.error here) reads
    // fine as text on its own low-alpha wash in both themes. The old
    // Colors.orange.shade900 was picked for contrast against a *light*
    // amber background specifically and went dark-on-dark the moment
    // that background alpha-blended over a dark surface instead.
    final bg = warn
        ? EsokoColors.amber.withValues(alpha: 0.14)
        : ok
        ? scheme.primary.withValues(alpha: 0.14)
        : scheme.error.withValues(alpha: 0.12);
    final fg = warn
        ? EsokoColors.amber
        : ok
        ? scheme.primary
        : scheme.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(EsokoRadius.pill),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return iso;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${t.day} ${months[t.month - 1]} ${t.year}';
  }
}
