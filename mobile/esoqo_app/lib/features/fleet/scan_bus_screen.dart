import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'fare_pay_screen.dart';
import 'fleet_repository.dart';

/// Scan a bus boarding QR (esoko://t?...) or type BUS-XXXXXX.
/// Thin UI: resolves via GET /v1/trips/resolve, then pushes FarePayScreen.
class ScanBusScreen extends ConsumerStatefulWidget {
  const ScanBusScreen({super.key});

  @override
  ConsumerState<ScanBusScreen> createState() => _ScanBusScreenState();
}

class _ScanBusScreenState extends ConsumerState<ScanBusScreen> {
  final _code = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _resolve(String code) async {
    if (code.trim().isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final resolved = await ref
          .read(fleetRepositoryProvider)
          .resolveTrip(code);
      if (resolved == null) {
        setState(() => _error = 'No bus found for that code.');
        return;
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => FarePayScreen(
            initialSlug: resolved.orgSlug,
            resolvedTripId: resolved.trip.tripId,
            resolvedPlate: resolved.trip.vehiclePlate,
            tripQrCode: code.trim(),
          ),
        ),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach Esoko. Check your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Scan bus QR'),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s4),
          children: [
            const EsokoPageLead(
              'Point at the QR inside the matatu, or type the BUS code.',
            ),
            const SizedBox(height: EsokoSpacing.s4),
            SizedBox(
              height: 280,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(EsokoRadius.md),
                child: MobileScanner(
                  onDetect: (cap) {
                    final v = cap.barcodes.firstOrNull?.rawValue;
                    if (v != null) _resolve(v);
                  },
                ),
              ),
            ),
            const SizedBox(height: EsokoSpacing.s4),
            EsokoField.code(
              controller: _code,
              label: 'Bus code',
              hint: 'e.g. BUS-4F8K2Q',
              onSubmitted: _resolve,
            ),
            const SizedBox(height: EsokoSpacing.s3),
            SizedBox(
              height: EsokoSpacing.s7,
              child: EsokoButton.primary(
                expand: false,
                label: 'Find bus',
                loading: _busy,
                onPressed: () => _resolve(_code.text),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              EsokoFormError(message: _error!),
            ],
          ],
        ),
      ),
    );
  }
}
