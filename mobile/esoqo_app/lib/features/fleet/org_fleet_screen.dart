import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'fleet_models.dart';
import 'fleet_providers.dart';
import 'fleet_repository.dart';
import 'org_staff_screen.dart';

/// Manager console for one transport company — every section is gated
/// server-side (trip.read / fleet.read / crew.read / vehicle.track),
/// so what renders here is exactly what the session's capabilities
/// allow; a denied section surfaces its message, never another org's
/// data.
class OrgFleetScreen extends ConsumerWidget {
  const OrgFleetScreen({super.key, required this.orgId, required this.orgName});
  final String orgId;
  final String orgName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: EsoqoAppBar(title: orgName),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(orgTripsProvider(orgId));
            ref.invalidate(positionsProvider(orgId));
            ref.invalidate(vehiclesProvider(orgId));
            ref.invalidate(crewProvider(orgId));
          },
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView(
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                children: [
                  EsoqoSectionHeader(
                    title: 'On duty now',
                    subtitle: 'Vehicle, driver and tout per trip.',
                  ),
                  const SizedBox(height: EsoqoSpacing.s2),
                  _trips(context, ref),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoSectionHeader(
                    title: 'Where are my vehicles?',
                    subtitle: 'Latest position per bus.',
                  ),
                  const SizedBox(height: EsoqoSpacing.s2),
                  _positions(ref),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoSectionHeader(title: 'Fleet', subtitle: 'Registered vehicles.'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  _vehicles(ref),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoSectionHeader(title: 'Crew', subtitle: 'Drivers and touts.'),
                  const SizedBox(height: EsoqoSpacing.s2),
                  _crew(ref),
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoListTile(
                    title: 'Staff & duty roles',
                    subtitle: 'Who can act as scanner, manager or crew for this org — suspend or reinstate access.',
                    icon: Icons.badge_outlined,
                    iconColor: EsoqoColors.blue,
                    iconBackground: EsoqoColors.blueTint,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => OrgStaffScreen(orgId: orgId, orgName: orgName)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _trips(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(orgTripsProvider(orgId));
    return EsoqoAsyncView(
      value: trips,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No trips yet.',
      emptyIcon: Icons.route_outlined,
      onRetry: () => ref.invalidate(orgTripsProvider(orgId)),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: i,
              child: EsoqoListTile(
                title: '${list[i].vehiclePlate} · ${list[i].status}',
                subtitle: list[i].crewLabel,
                leading: const Icon(Icons.directions_bus_outlined),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => TripDetailScreen(orgId: orgId, trip: list[i]),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _positions(WidgetRef ref) {
    final positions = ref.watch(positionsProvider(orgId));
    return EsoqoAsyncView(
      value: positions,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No positions yet — crew phones report as trips move.',
      emptyIcon: Icons.location_on_outlined,
      onRetry: () => ref.invalidate(positionsProvider(orgId)),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: i,
              child: EsoqoListTile(
                title: list[i].vehiclePlate,
                subtitle: '${list[i].lat}, ${list[i].lng} · ${list[i].at}',
                leading: const Icon(Icons.location_on_outlined),
                onTap: () => launchUrl(
                  Uri.parse('https://www.google.com/maps/search/?api=1&query=${list[i].lat},${list[i].lng}'),
                  mode: LaunchMode.externalApplication,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _vehicles(WidgetRef ref) {
    final vehicles = ref.watch(vehiclesProvider(orgId));
    return EsoqoAsyncView(
      value: vehicles,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No vehicles registered.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(vehiclesProvider(orgId)),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: i,
              child: EsoqoListTile(
                title: list[i].plateNo,
                subtitle: [
                  if (list[i].label != null) list[i].label!,
                  if (list[i].capacity != null) '${list[i].capacity} seats',
                  if (list[i].grounded) 'GROUNDED',
                ].join(' · '),
                leading: const Icon(Icons.directions_bus_outlined),
                onTap: () {},
              ),
            ),
        ],
      ),
    );
  }

  Widget _crew(WidgetRef ref) {
    final crew = ref.watch(crewProvider(orgId));
    return EsoqoAsyncView(
      value: crew,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No crew onboarded.',
      emptyIcon: Icons.badge_outlined,
      onRetry: () => ref.invalidate(crewProvider(orgId)),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: i,
              child: EsoqoListTile(
                title: list[i].name,
                subtitle: '${list[i].role}${list[i].active ? '' : ' · inactive'}',
                leading: const Icon(Icons.badge_outlined),
                onTap: () {},
              ),
            ),
        ],
      ),
    );
  }
}

/// One trip: collections (declared cash vs M-Pesa prompts), a declare
/// form, and close-trip — the answers to "how much are they collecting".
class TripDetailScreen extends ConsumerStatefulWidget {
  const TripDetailScreen({super.key, required this.orgId, required this.trip});
  final String orgId;
  final FleetTrip trip;

  @override
  ConsumerState<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends ConsumerState<TripDetailScreen> {
  final _amountController = TextEditingController();
  String? _crewId;
  bool _busy = false;
  String? _notice;

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _declare() async {
    final crewId = _crewId;
    final amount = double.tryParse(_amountController.text.trim()) ?? -1;
    if (crewId == null || amount < 0) {
      setState(() => _notice = 'Pick a crew member and enter the cash counted.');
      return;
    }
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await ref.read(fleetRepositoryProvider).declareCash(
            tripId: widget.trip.id,
            crewId: crewId,
            amountKes: amount,
          );
      ref.invalidate(collectionsProvider(widget.trip.id));
      setState(() => _notice = 'Declaration recorded.');
    } on ApiException catch (e) {
      setState(() => _notice = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close() async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await ref.read(fleetRepositoryProvider).closeTrip(widget.trip.id);
      ref.invalidate(orgTripsProvider(widget.orgId));
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      setState(() => _notice = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final summary = ref.watch(collectionsProvider(trip.id));
    final crew = ref.watch(crewProvider(widget.orgId));
    return Scaffold(
      appBar: EsoqoAppBar(title: trip.vehiclePlate),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(EsoqoSpacing.s4),
          children: [
            Text(trip.crewLabel),
            const SizedBox(height: EsoqoSpacing.s2),
            Text('Status: ${trip.status} · Started ${trip.startedAt}'),
            const SizedBox(height: EsoqoSpacing.s4),
            EsoqoSectionHeader(
              title: 'Collections',
              subtitle: 'Declared cash vs M-Pesa prompts.',
            ),
            const SizedBox(height: EsoqoSpacing.s2),
            EsoqoAsyncView(
              value: summary,
              onRetry: () => ref.invalidate(collectionsProvider(trip.id)),
              data: (context, s) => _summaryCard(s),
            ),
            const SizedBox(height: EsoqoSpacing.s5),
            EsoqoSectionHeader(
              title: 'Declare cash',
              subtitle: 'What the tout counted on this trip.',
            ),
            const SizedBox(height: EsoqoSpacing.s2),
            crew.when(
              data: (list) => EsoqoDropdown<String>(
                label: 'Crew member',
                initialValue: _crewId,
                items: [
                  for (final c in list.where((c) => c.active))
                    DropdownMenuItem(value: c.id, child: Text('${c.name} (${c.role})')),
                ],
                onChanged: (v) => setState(() => _crewId = v),
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: EsoqoSpacing.s3),
                child: EsoqoSkeleton(height: 44, radius: EsoqoRadius.md),
              ),
              error: (_, _) => const Text('Could not load crew.'),
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            EsoqoField.amount(
              controller: _amountController,
              label: 'Cash counted',
              hint: 'e.g. 4500',
            ),
            const SizedBox(height: EsoqoSpacing.s3),
            EsoqoButton.primary(
              expand: false,
              label: 'Record declaration',
              icon: Icons.check_outlined,
              loading: _busy,
              onPressed: _declare,
            ),
            if (_notice != null) ...[
              const SizedBox(height: EsoqoSpacing.s2),
              Text(_notice!),
            ],
            if (trip.active) ...[
              const SizedBox(height: EsoqoSpacing.s5),
              EsoqoButton.destructive(
                label: 'Close trip',
                confirm: 'Closing a trip ends it for everyone on board and '
                    'cannot be undone. Close it now?',
                icon: Icons.flag_outlined,
                loading: _busy,
                onPressed: _close,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _summaryCard(CollectionsSummary s) {
    return EsoqoCard(
      padding: const EdgeInsets.all(EsoqoSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _row('M-Pesa confirmed', 'KES ${s.mpesaConfirmedKes}'),
          _row('Cash fares', 'KES ${s.cashFaresKes}'),
          _row('Declared cash', 'KES ${s.declaredCashKes}'),
          _row(
            'Cash variance',
            'KES ${s.cashVarianceKes}',
            highlight: s.hasVariance,
          ),
          _row('Fares', '${s.fareCount}'),
          _row('Declarations', '${s.declarationCount}'),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: highlight ? EsoqoColors.red : null,
            ),
          ),
        ],
      ),
    );
  }
}
