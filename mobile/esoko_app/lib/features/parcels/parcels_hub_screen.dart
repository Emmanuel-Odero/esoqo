import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

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

final availableJobsProvider = FutureProvider.autoDispose<List<AvailableJob>>(
  (ref) => ref.watch(parcelsRepositoryProvider).listAvailableJobs(),
);

/// Three tabs, one screen: "Sent" (what I'm shipping, with the delivery
/// code to pass on), "Holding" (what's currently in my custody as a
/// driver/handler — the scoped-session-shaped screen Phases 2/6/7 each
/// have their own version of), and "Nearby" (BOOKED jobs near my last
/// posted location, first-tap-claims-it — the gig/on-demand half of the
/// hybrid dispatch model; "Holding"'s code-entry stays the fleet/
/// scheduled-pickup half). Accepting an already-assigned parcel is a
/// code entry on the Holding tab, not the universal scanner — a
/// handler's whole job is custody transfer, one dedicated action, not
/// routed through the general-purpose scan-and-dispatch screen.
///
/// The Sent/Holding toggle is an [EsokoSegmentedToggle] pill above an
/// `IndexedStack` — it used to visually collide with the first list
/// item below it (see SCREEN_CONVENTIONS.md), which turned out to be a
/// report-vs-paint size mismatch in the toggle's own `ButtonStyle`, not
/// a structural problem with this layout — see esoko_segmented_toggle
/// .dart's doc comment for the actual fix (`minimumSize`, not
/// `visualDensity`). A `TabBar`-in-app-bar version was tried as a fix
/// but the pill toggle is the preferred look, so this stayed as-is.
class ParcelsHubScreen extends ConsumerStatefulWidget {
  const ParcelsHubScreen({super.key});

  @override
  ConsumerState<ParcelsHubScreen> createState() => _ParcelsHubScreenState();
}

class _ParcelsHubScreenState extends ConsumerState<ParcelsHubScreen> {
  final _acceptCodeController = TextEditingController();
  bool _acceptBusy = false;
  int _tab = 0;

  // Nearby-jobs tab state. The ping loop only ever fires while this tab
  // is the visible one (checked inside the timer callback, not by
  // starting/stopping the timer itself) — simpler than tearing a Timer
  // down and rebuilding it on every tab switch, and the cost of a
  // to-nobody tick every 30s when the tab isn't open is negligible.
  Position? _position;
  bool _locating = false;
  String? _locationError;
  String? _claimingCode;
  Timer? _pingTimer;

  @override
  void initState() {
    super.initState();
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_tab == 2 && _position != null) _postPing(_position!);
    });
  }

  @override
  void dispose() {
    _acceptCodeController.dispose();
    _pingTimer?.cancel();
    super.dispose();
  }

  void _refreshAll() {
    ref.invalidate(myParcelsProvider);
    ref.invalidate(heldParcelsProvider);
  }

  Future<void> _postPing(Position position) async {
    try {
      await ref.read(parcelsRepositoryProvider).postCourierPing(
            lat: position.latitude,
            lng: position.longitude,
          );
      ref.invalidate(availableJobsProvider);
    } on ApiException {
      // A ping failing (e.g. not an active courier yet) shouldn't
      // interrupt browsing the tab — the jobs list itself is what tells
      // the person whether anything's actually available to them.
    }
  }

  Future<void> _useMyLocationForJobs() async {
    setState(() {
      _locating = true;
      _locationError = null;
    });
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(() {
          _locationError = 'Location permission denied — enable it to see nearby jobs.';
          _locating = false;
        });
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() {
          _locationError = 'Turn on location services to see nearby jobs.';
          _locating = false;
        });
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      setState(() {
        _position = position;
        _locating = false;
      });
      await _postPing(position);
    } catch (_) {
      if (mounted) {
        setState(() {
          _locationError = 'Could not get your location. Try again.';
          _locating = false;
        });
      }
    }
  }

  Future<void> _claimJob(AvailableJob job) async {
    setState(() => _claimingCode = job.code);
    try {
      await ref.read(parcelsRepositoryProvider).claimJob(job.code);
      ref.invalidate(availableJobsProvider);
      ref.invalidate(heldParcelsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Claimed ${job.code} — see it under Holding.')));
      }
    } on ApiException catch (e) {
      if (mounted) {
        // ALREADY_DELIVERED is dbx.ClaimParcel's shared "already gone"
        // code (see that function's own comment) — someone else beat
        // this courier to it, refresh rather than alarm over it.
        final message = e.code == 'ALREADY_DELIVERED'
            ? 'Someone else claimed that one first.'
            : e.message;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
        ref.invalidate(availableJobsProvider);
      }
    } finally {
      if (mounted) setState(() => _claimingCode = null);
    }
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
          hint: 'Ask the receiver for their code',
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
    final jobs = ref.watch(availableJobsProvider);
    // Bar-less Scaffold — reached only via the Home hub's EsokoServiceScaffold
    // wrapper, which already supplies the navy app bar (see
    // TransportScreen's identical comment). Keeping Scaffold here
    // (rather than a bare Column) is what lets the FAB below still
    // float correctly.
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EsokoSpacing.s4,
                EsokoSpacing.s4,
                EsokoSpacing.s4,
                EsokoSpacing.s2,
              ),
              child: EsokoSegmentedToggle<int>(
                selected: _tab,
                onChanged: (v) => setState(() => _tab = v),
                options: const [(0, 'Sent'), (1, 'Holding'), (2, 'Nearby')],
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
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: EsokoSpacing.s2),
                        itemBuilder: (context, i) {
                          final p = list[i];
                          final statusLabel = p.status == 'DRAFT_PENDING_PAYMENT'
                              ? 'Draft — pending payment'
                              : p.status;
                          return EsokoListTile(
                            title: '${p.originLabel} → ${p.destinationLabel}',
                            subtitle: '${p.code} · $statusLabel',
                            icon: p.status == 'DRAFT_PENDING_PAYMENT'
                                ? Icons.pending_outlined
                                : Icons.local_shipping_outlined,
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
                            // Fixed width, not a bare Row child — an
                            // IndexedStack (unlike the TabBarView this
                            // screen used to use) lays out *every* tab
                            // eagerly, even hidden ones, so this button
                            // now gets laid out on first frame instead
                            // of only once the Holding tab is opened.
                            // Un-widthed, FilledButton's internal
                            // ButtonStyleButton throws "BoxConstraints
                            // forces an infinite width" in that context
                            // — the exact same family of silent-render
                            // bug as the ListTile.trailing rule in
                            // SCREEN_CONVENTIONS.md, just from a Row
                            // instead of a trailing slot, and one that
                            // corrupted this whole frame's paint (that's
                            // what actually caused the toggle above to
                            // look cut off).
                            SizedBox(
                              width: 96,
                              child: EsokoLoadingButton(
                                label: 'Accept',
                                loading: _acceptBusy,
                                onPressed: _acceptParcel,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: RefreshIndicator(
                          onRefresh: () async =>
                              ref.invalidate(heldParcelsProvider),
                          child: EsokoAsyncView(
                            value: held,
                            isEmpty: (l) => l.isEmpty,
                            emptyMessage: 'Not holding any parcels right now.',
                            emptyIcon: Icons.inventory_2_outlined,
                            onRetry: () => ref.invalidate(heldParcelsProvider),
                            data: (context, list) => ListView.separated(
                              padding: const EdgeInsets.symmetric(
                                horizontal: EsokoSpacing.s4,
                              ),
                              itemCount: list.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(height: EsokoSpacing.s2),
                              itemBuilder: (context, i) {
                                final p = list[i];
                                return EsokoListTile(
                                  title:
                                      '${p.originLabel} → ${p.destinationLabel}',
                                  subtitle: '${p.code} · to ${p.receiverName}',
                                  icon: Icons.inventory_2_outlined,
                                  // Fixed width, not a bare TextButton —
                                  // see SCREEN_CONVENTIONS.md / the fix in
                                  // org_duty_switcher_screen.dart: an
                                  // unconstrained button in `trailing`
                                  // throws "Trailing widget consumes the
                                  // entire tile width" once title+subtitle
                                  // get long enough (a real origin →
                                  // destination label plus a receiver
                                  // name easily does), which renders as a
                                  // silently blank tile, not a crash.
                                  trailing: SizedBox(
                                    width: 84,
                                    child: TextButton(
                                      onPressed: () => _deliverParcel(p),
                                      child: const Text('Deliver'),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  _NearbyJobsTab(
                    jobs: jobs,
                    position: _position,
                    locating: _locating,
                    locationError: _locationError,
                    claimingCode: _claimingCode,
                    onUseLocation: _useMyLocationForJobs,
                    onClaim: _claimJob,
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
              MaterialPageRoute(builder: (_) => ParcelStatusScreen(code: code)),
            );
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('Send parcel'),
      ),
    );
  }
}

/// BOOKED, unassigned parcels near this courier's last posted ping —
/// the gig/on-demand claim flow (see this screen's own doc comment).
/// Location is opt-in per visit, same "Use my location" tap
/// store_list_screen.dart already asks for — nothing pings silently in
/// the background before someone's actually looking at this tab.
class _NearbyJobsTab extends StatelessWidget {
  const _NearbyJobsTab({
    required this.jobs,
    required this.position,
    required this.locating,
    required this.locationError,
    required this.claimingCode,
    required this.onUseLocation,
    required this.onClaim,
  });

  final AsyncValue<List<AvailableJob>> jobs;
  final Position? position;
  final bool locating;
  final String? locationError;
  final String? claimingCode;
  final VoidCallback onUseLocation;
  final ValueChanged<AvailableJob> onClaim;

  @override
  Widget build(BuildContext context) {
    if (position == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(EsokoSpacing.s5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.near_me_outlined, size: 40),
              const SizedBox(height: EsokoSpacing.s3),
              const Text(
                'Share your location to see jobs near you.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: EsokoSpacing.s3),
              EsokoLoadingButton(
                label: 'Use my location',
                loading: locating,
                onPressed: onUseLocation,
              ),
              if (locationError != null) ...[
                const SizedBox(height: EsokoSpacing.s2),
                EsokoFormError(message: locationError!),
              ],
            ],
          ),
        ),
      );
    }
    return EsokoAsyncView(
      value: jobs,
      isEmpty: (l) => l.isEmpty,
      emptyMessage: 'No jobs nearby right now.',
      emptyIcon: Icons.local_shipping_outlined,
      data: (context, list) => ListView.separated(
        padding: const EdgeInsets.all(EsokoSpacing.s4),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s2),
        itemBuilder: (context, i) {
          final job = list[i];
          final subtitle = [
            job.code,
            if (job.distanceKm != null) '${job.distanceKm!.toStringAsFixed(1)} km away',
            if (job.priceKes != null) 'KES ${double.tryParse(job.priceKes!)?.toStringAsFixed(0) ?? job.priceKes}',
          ].join(' · ');
          return EsokoListTile(
            title: '${job.originLabel} → ${job.destinationLabel}',
            subtitle: subtitle,
            icon: Icons.local_shipping_outlined,
            trailing: SizedBox(
              width: 84,
              child: EsokoLoadingButton(
                label: 'Claim',
                loading: claimingCode == job.code,
                onPressed: () => onClaim(job),
              ),
            ),
          );
        },
      ),
    );
  }
}
