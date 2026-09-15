import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/fleet_repository.dart';
import 'parcel_models.dart';
import 'parcels_repository.dart';

/// A conductor putting a parcel they're already holding onto their bus.
///
/// This is the whole "send it on the bus you ride" idea at the point of
/// use. Esoqo already runs the vehicle, already knows where it is
/// (VehiclePing, reported for the passengers sitting in it), and
/// already has a conductor on board who scans things for a living. The
/// parcel inherits the bus's live position for free — no new device, no
/// second ping loop, no extra battery drain on anyone's phone.
///
/// Two facts are checked server-side and kept separate: this person
/// must already hold the parcel (a normal scan handoff), and must be
/// crew on this trip. Boarding records which vehicle the holder is on;
/// it never moves custody.
class LoadOnBusScreen extends ConsumerStatefulWidget {
  const LoadOnBusScreen({super.key, required this.parcel});

  final ParcelRow parcel;

  @override
  ConsumerState<LoadOnBusScreen> createState() => _LoadOnBusScreenState();
}

class _LoadOnBusScreenState extends ConsumerState<LoadOnBusScreen> {
  MyTrip? _myTrip;
  List<TripStage> _stages = const [];
  String? _dropStageId;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final trip = await ref.read(fleetRepositoryProvider).myActiveTrip();
      if (!mounted) return;
      setState(() => _myTrip = trip);
      if (trip != null) {
        final stages = await ref.read(parcelsRepositoryProvider).listTripStages(trip.id);
        if (mounted) setState(() => _stages = stages);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _board() async {
    final trip = _myTrip;
    if (trip == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(parcelsRepositoryProvider).boardOnTrip(
            code: widget.parcel.code,
            tripId: trip.id,
            dropStageId: _dropStageId,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return Scaffold(
      appBar: const EsoqoAppBar(title: 'Load on the bus'),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(EsoqoSpacing.s5),
                    children: [
                      Text(
                        widget.parcel.code,
                        style: EsoqoTypography.mono(
                          fontSize: EsoqoTypeScale.cardTitle,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text('To ${widget.parcel.receiverName}', style: small),
                      Text(widget.parcel.destinationLabel, style: small),
                      const SizedBox(height: EsoqoSpacing.s5),

                      if (_myTrip == null) ...[
                        // The honest failure: this action only exists for
                        // someone crewing a live trip, and saying so beats
                        // a generic error nobody can act on.
                        EsoqoInlineNotice(
                          color: EsoqoColors.amber,
                          icon: EsoqoIconName.alertTriangle,
                          message: "You aren't on a running trip right now. "
                              'Start your trip in Transport first, then load parcels onto it.',
                        ),
                      ] else ...[
                        EsoqoCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Your bus', style: small),
                              const SizedBox(height: EsoqoSpacing.s1),
                              Text(
                                _myTrip!.vehiclePlate,
                                style: EsoqoTypography.mono(
                                  fontSize: EsoqoTypeScale.sectionTitle,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              if (_myTrip!.routeName != null)
                                Text(_myTrip!.routeName!, style: small),
                            ],
                          ),
                        ),
                        const SizedBox(height: EsoqoSpacing.s4),

                        if (_stages.isEmpty)
                          Text(
                            "This route has no named stops, so the parcel rides to the last one.",
                            style: small,
                          )
                        else ...[
                          Text(
                            'Where does it come off? Picking a stop is what '
                            'reminds you to hand it over — without one it '
                            'rides to the last stop.',
                            style: small,
                          ),
                          const SizedBox(height: EsoqoSpacing.s2),
                          DropdownButtonFormField<String?>(
                            initialValue: _dropStageId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Drop-off stop',
                              prefixIcon: Icon(Icons.signpost_outlined),
                            ),
                            items: [
                              const DropdownMenuItem<String?>(
                                value: null,
                                child: Text('Last stop'),
                              ),
                              for (final s in _stages)
                                DropdownMenuItem<String?>(
                                  value: s.id,
                                  child: Text(s.name),
                                ),
                            ],
                            onChanged: (v) => setState(() => _dropStageId = v),
                          ),
                        ],

                        const SizedBox(height: EsoqoSpacing.s4),
                        EsoqoInlineNotice(
                          color: EsoqoColors.navy,
                          icon: EsoqoIconName.info,
                          message: 'The sender and receiver both get a text with '
                              'the plate number, and can watch the bus move on '
                              'the tracking page.',
                        ),
                      ],

                      if (_error != null) ...[
                        const SizedBox(height: EsoqoSpacing.s3),
                        EsoqoFormError(message: _error!),
                      ],
                      const SizedBox(height: EsoqoSpacing.s5),
                      if (_myTrip != null)
                        EsoqoButton.primary(
                          expand: false,
                          label: 'Load onto ${_myTrip!.vehiclePlate}',
                          loading: _busy,
                          onPressed: _board,
                        ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
