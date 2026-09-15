import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'fleet_models.dart';
import 'fleet_providers.dart';
import 'fleet_repository.dart';

enum _Stage { trips, pay, waiting, done, failed }

/// Pay a bus fare from the app — POST /v1/fares → M-Pesa STK → poll
/// GET /v1/fares/:id. Public: works signed out (guest fare, same as
/// guest booking), pre-fills identity when signed in.
class FarePayScreen extends ConsumerStatefulWidget {
  const FarePayScreen({
    super.key,
    this.initialSlug = '',
    this.resolvedTripId = '',
    this.resolvedPlate = '',
    this.tripQrCode = '',
  });
  final String initialSlug;

  /// Set when arriving from ScanBusScreen (GET /v1/trips/resolve).
  final String resolvedTripId;
  final String resolvedPlate;

  /// Raw scanned payload (esoqo://t?... or BUS-XXXXXX) — sent back as
  /// tripQrCode so Go re-verifies the HMAC instead of trusting tripId.
  final String tripQrCode;

  @override
  ConsumerState<FarePayScreen> createState() => _FarePayScreenState();
}

class _FarePayScreenState extends ConsumerState<FarePayScreen> {
  late final TextEditingController _slugController;
  late final TextEditingController _nameController;
  late final TextEditingController _msisdnController;
  String _slug = '';
  ActiveTrip? _trip;
  FareStage? _stage;
  _Stage _stageState = _Stage.trips;
  String? _error;
  String? _fareId;
  String? _totalKes;
  Timer? _pollTimer;
  // Thin additions for QR + voucher: tripQrCode passthrough and
  // VOUCHER method with optional voucherId (listed from /v1/me/vouchers).
  String _tripQrCode = '';
  String _method = 'MPESA_STK';
  String? _voucherId;

  @override
  void initState() {
    super.initState();
    _slugController = TextEditingController(text: widget.initialSlug);
    _slug = widget.initialSlug.trim();
    _tripQrCode = widget.tripQrCode;
    _nameController = TextEditingController();
    _msisdnController = TextEditingController();
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _nameController.text = auth.profile.displayName;
      _msisdnController.text = auth.profile.msisdn ?? '';
    }
    if (_tripQrCode.isNotEmpty) _bootstrapFromQr(_tripQrCode);
  }

  /// Arriving from ScanBusScreen: resolve stages for the scanned code so
  /// the payer picks a fare without typing a company code.
  Future<void> _bootstrapFromQr(String code) async {
    try {
      final resolved = await ref
          .read(fleetRepositoryProvider)
          .resolveTrip(code);
      if (resolved == null || !mounted) return;
      final trip = resolved.trip;
      // The resolve call doesn't echo the plate's display form — prefer
      // the push-time plate the scanner already had.
      final plate = trip.vehiclePlate.isNotEmpty
          ? trip.vehiclePlate
          : widget.resolvedPlate;
      setState(() {
        _trip = ActiveTrip(
          tripId: trip.tripId,
          vehiclePlate: plate,
          routeName: trip.routeName,
          stages: trip.stages,
        );
        _stage = trip.stages.isNotEmpty ? trip.stages.last : null;
        _stageState = _Stage.pay;
      });
    } catch (_) {
      // Fall back to manual company-code flow below.
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _slugController.dispose();
    _nameController.dispose();
    _msisdnController.dispose();
    super.dispose();
  }

  void _loadTrips() {
    setState(() {
      _slug = _slugController.text.trim();
      _trip = null;
      _stage = null;
      _stageState = _Stage.trips;
      _error = null;
    });
    if (_slug.isNotEmpty) ref.invalidate(activeTripsProvider(_slug));
  }

  Future<void> _pay() async {
    final trip = _trip;
    if (trip == null) return;
    if (_nameController.text.trim().isEmpty ||
        _msisdnController.text.trim().isEmpty) {
      setState(() {
        _stageState = _Stage.failed;
        _error = 'Enter your name and M-Pesa number';
      });
      return;
    }
    setState(() {
      _stageState = _Stage.waiting;
      _error = null;
    });
    try {
      final placed = await ref
          .read(fleetRepositoryProvider)
          .payFare(
            trip: trip,
            stage: _stage,
            tripQrCode: _tripQrCode,
            method: _method,
            voucherId: _voucherId,
            buyerName: _nameController.text.trim(),
            buyerMsisdn: _msisdnController.text.trim(),
          );
      _fareId = placed.fareId;
      _totalKes = placed.totalKes;
      if (placed.confirmed) {
        setState(() => _stageState = _Stage.done);
        return;
      }
      if (placed.paymentError != null) {
        setState(() {
          _stageState = _Stage.failed;
          _error = 'Could not start the M-Pesa payment — try again.';
        });
        return;
      }
      _startPolling();
    } on ApiException catch (e) {
      setState(() {
        _stageState = _Stage.failed;
        _error = e.message;
      });
    }
  }

  void _startPolling() {
    var attempts = 0;
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      if (_fareId == null || attempts > 15) {
        timer.cancel();
        // Don't strand the user on an indefinite spinner — surface a
        // recoverable failure with retry (same contract as the other
        // money flows).
        if (mounted && _stageState == _Stage.waiting) {
          setState(() {
            _stageState = _Stage.failed;
            _error = 'We could not confirm your M-Pesa payment. If you were charged, it will appear once the crew verifies — otherwise try again.';
          });
        }
        return;
      }
      try {
        if (await ref.read(fleetRepositoryProvider).isFareConfirmed(_fareId!)) {
          timer.cancel();
          if (mounted) setState(() => _stageState = _Stage.done);
        }
      } on ApiException {
        // transient — keep polling until the attempt cap above
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Pay bus fare'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsoqoSpacing.s5),
              // Same contract as the other money flows: the stage
              // machine cross-fades, money never visually jumps.
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsoqoMotion.medium,
                switchInCurve: EsoqoMotion.easeOut,
                switchOutCurve: EsoqoMotion.easeOut,
                child: KeyedSubtree(key: ValueKey(_stageState), child: _body()),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_stageState) {
      case _Stage.waiting:
        return EsoqoResultView.waiting(
          title: 'Complete payment on your phone',
          message: 'Enter your M-Pesa PIN when the prompt arrives.',
          amountKes: _totalKes,
        );
      case _Stage.done:
        return EsoqoResultView.success(
          title: 'Fare paid',
          message: 'Show this screen to the tout when boarding.',
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).popUntil((r) => r.isFirst),
        );
      case _Stage.failed:
        return EsoqoResultView.failure(
          errorMessage: _error ?? 'Something went wrong',
          primaryLabel: 'Start over',
          onPrimary: () => setState(() => _stageState = _Stage.trips),
        );
      case _Stage.trips:
      case _Stage.pay:
        return _tripsStage();
    }
  }

  Widget _tripsStage() {
    return ListView(
      shrinkWrap: true,
      children: [
        const EsoqoPageLead('Pick a bus on your route, then pay by M-Pesa.'),
        const SizedBox(height: EsoqoSpacing.s4),
        Row(
          children: [
            Expanded(
              child: EsoqoField.search(
                controller: _slugController,
                label: 'Company code',
                hint: 'e.g. demo-rapid-coach',
                onSubmitted: (_) => _loadTrips(),
              ),
            ),
            const SizedBox(width: EsoqoSpacing.s2),
            IconButton.filled(
              onPressed: _loadTrips,
              icon: const Icon(Icons.search),
              tooltip: 'Find buses',
            ),
          ],
        ),
        const SizedBox(height: EsoqoSpacing.s4),
        if (_slug.isEmpty)
          const Text(
            'Enter a transport company code above to see its buses on the road right now.',
          )
        else
          _tripList(),
        if (_trip != null) ...[
          const SizedBox(height: EsoqoSpacing.s5),
          Text(
            'Pay for ${_trip!.vehiclePlate}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: EsoqoSpacing.s3),
          if (_trip!.stages.isNotEmpty)
            EsoqoDropdown<FareStage>(
              label: 'Where to?',
              initialValue: _stage,
              items: [
                for (final s in _trip!.stages)
                  DropdownMenuItem(
                    value: s,
                    child: Text('${s.name} — KES ${s.fareKes}'),
                  ),
              ],
              onChanged: (s) => setState(() => _stage = s),
            ),
          const SizedBox(height: EsoqoSpacing.s3),
          EsoqoSegmentedToggle<String>(
            selected: _method,
            onChanged: (m) => setState(() => _method = m),
            options: const [('MPESA_STK', 'M-Pesa'), ('VOUCHER', 'Voucher')],
          ),
          const SizedBox(height: EsoqoSpacing.s3),
          EsoqoPayerFields(
            nameController: _nameController,
            msisdnController: _msisdnController,
            payLabel: _stage == null
                ? 'Pay fare'
                : 'Pay KES ${_stage!.fareKes}',
            onPay: _pay,
          ),
        ],
      ],
    );
  }

  Widget _tripList() {
    final trips = ref.watch(activeTripsProvider(_slug));
    return EsoqoAsyncView(
      value: trips,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No buses on the road for this company right now.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(activeTripsProvider(_slug)),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: i,
              child: _TripTile(
                trip: list[i],
                selected: _trip?.tripId == list[i].tripId,
                onTap: () {
                  EsoqoHaptics.tap();
                  setState(() {
                    _trip = list[i];
                    _stage = list[i].stages.isNotEmpty
                        ? list[i].stages.last
                        : null;
                    _stageState = _Stage.pay;
                  });
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// One bus on the road — the selected trip reads as the green "yours"
/// pick, unselected ones as quiet rows.
class _TripTile extends StatelessWidget {
  const _TripTile({
    required this.trip,
    required this.selected,
    required this.onTap,
  });

  final ActiveTrip trip;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return EsoqoListTile(
      title: trip.vehiclePlate,
      subtitle: trip.routeName ?? 'On duty',
      icon: Icons.directions_bus_outlined,
      iconColor: selected ? scheme.primary : null,
      // An alpha wash of the theme's own primary, not the fixed
      // EsoqoColors.greenTint — that pastel only ever read right as a
      // *light* highlight; in dark mode it was a light patch glued onto
      // an otherwise-dark row.
      iconBackground: selected
          ? scheme.primary.withValues(alpha: isDark ? 0.22 : 0.14)
          : null,
      trailing: selected
          ? Icon(Icons.check_circle, color: scheme.primary, size: 22)
          : const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}
