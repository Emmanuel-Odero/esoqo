import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'parcel_models.dart';
import 'parcel_payment_screen.dart';
import 'parcels_repository.dart';

/// Standard price, or a bounded "make an offer" — every reason and its
/// resulting price come straight from the admin-configured
/// ParcelPricingRule (via GET /v1/parcels/pricing); nothing here is a
/// free-typed number, so whatever the sender picks is exactly what
/// POST /v1/parcels/:code/price will also independently re-derive and
/// accept.
class ParcelPricingScreen extends ConsumerStatefulWidget {
  const ParcelPricingScreen({
    super.key,
    required this.code,
    required this.parcelType,
    this.originZoneId,
    this.destinationZoneId,
  });

  final String code;
  final String parcelType;
  final String? originZoneId;
  final String? destinationZoneId;

  @override
  ConsumerState<ParcelPricingScreen> createState() =>
      _ParcelPricingScreenState();
}

class _ParcelPricingScreenState extends ConsumerState<ParcelPricingScreen> {
  ParcelPricing? _pricing;
  BargainReason? _selectedReason; // null == standard price
  bool _loading = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final pricing = await ref
          .read(parcelsRepositoryProvider)
          .getPricing(
            widget.parcelType,
            originZoneId: widget.originZoneId,
            destinationZoneId: widget.destinationZoneId,
          );
      if (mounted) setState(() { _pricing = pricing; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _continue() async {
    final pricing = _pricing;
    if (pricing == null) return;
    final priceKes = _selectedReason == null
        ? pricing.minKes
        : pricing.priceForReason(_selectedReason!);
    setState(() { _submitting = true; _error = null; });
    try {
      await ref.read(parcelsRepositoryProvider).setPrice(
            code: widget.code,
            priceKes: priceKes,
            bargainReason: _selectedReason?.reason,
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ParcelPaymentScreen(
            code: widget.code,
            priceKes: priceKes,
          ),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Choose a price'),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _pricing == null
                ? EsoqoErrorView(
                    message: _error ?? 'Could not load pricing',
                    onRetry: _load,
                  )
                : Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 480),
                      child: ListView(
                        padding: const EdgeInsets.all(EsoqoSpacing.s5),
                        children: [
                          EsoqoSubHeader('Standard price'),
                          if (_pricing!.distanceKm != null) ...[
                            const SizedBox(height: EsoqoSpacing.s1),
                            Text(
                              '${_pricing!.distanceKm!.toStringAsFixed(1)} km between the zones you picked — added to the price below.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                          const SizedBox(height: EsoqoSpacing.s2),
                          _priceOption(
                            title: 'Standard',
                            subtitle:
                                '${_pricing!.weightLabel} · usually KES ${_pricing!.minKes.format()}–${_pricing!.maxKes.format()}',
                            priceKes: _pricing!.minKes,
                            selected: _selectedReason == null,
                            onTap: () => setState(() => _selectedReason = null),
                          ),
                          if (_pricing!.bargainReasons.isNotEmpty) ...[
                            const SizedBox(height: EsoqoSpacing.s5),
                            EsoqoSubHeader('Make an offer'),
                            const SizedBox(height: EsoqoSpacing.s2),
                            Text(
                              'Pick a reason that applies — the price adjusts accordingly.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: EsoqoSpacing.s2),
                            for (final reason in _pricing!.bargainReasons)
                              Padding(
                                padding: const EdgeInsets.only(bottom: EsoqoSpacing.s2),
                                child: _priceOption(
                                  title: reason.reason,
                                  subtitle: 'Negotiable — ${reason.extraDiscountPct.toStringAsFixed(0)}% off the usual minimum',
                                  priceKes: _pricing!.priceForReason(reason),
                                  selected: _selectedReason?.reason == reason.reason,
                                  onTap: () => setState(() => _selectedReason = reason),
                                ),
                              ),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: EsoqoSpacing.s3),
                            EsoqoFormError(message: _error!),
                          ],
                          const SizedBox(height: EsoqoSpacing.s5),
                          EsoqoButton.primary(
                            expand: false,
                            label: 'Continue to payment',
                            loading: _submitting,
                            onPressed: _continue,
                          ),
                        ],
                      ),
                    ),
                  ),
      ),
    );
  }

  // Same selection-card shape schedule_booking_screen.dart's
  // _TicketClassCard uses for "pick one of several priced options" —
  // a theme-derived alpha wash of scheme.primary (not a fixed pastel,
  // which only reads right in light mode), EsoqoColors.line border,
  // EsoqoRadius.lg corners, and the check-circle/circle-outlined
  // selection glyph every other picker in the app uses. Kept local
  // (not lifted into a shared widget) since it's parcel-pricing
  // specific — title/subtitle/price, not a ticket class.
  Widget _priceOption({
    required String title,
    required String subtitle,
    required Money priceKes,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Material(
      color: selected
          ? scheme.primary.withValues(alpha: isDark ? 0.20 : 0.12)
          : Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsoqoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(EsoqoSpacing.s3),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? scheme.primary : EsoqoColors.line,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? scheme.primary : muted,
                size: 22,
              ),
              const SizedBox(width: EsoqoSpacing.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              Text(
                'KES ${priceKes.format()}',
                style: EsoqoTypography.mono(fontWeight: FontWeight.w700, color: scheme.primary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
