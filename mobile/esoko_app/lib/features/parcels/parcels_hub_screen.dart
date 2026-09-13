import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'book_parcel_screen.dart';
import 'complete_delivery_screen.dart';
import 'courier_earnings_screen.dart';
import 'load_on_bus_screen.dart';
import 'parcel_models.dart';
import 'parcel_status_screen.dart';
import 'parcels_repository.dart';

final myParcelsProvider = FutureProvider.autoDispose<List<ParcelRow>>(
  (ref) => ref.watch(parcelsRepositoryProvider).myParcels(),
);

final heldParcelsProvider = FutureProvider.autoDispose<List<ParcelRow>>(
  (ref) => ref.watch(parcelsRepositoryProvider).heldParcels(),
);

/// The cash a rider is still carrying. Its own provider rather than a
/// field on the held list, because it survives a parcel leaving that
/// list: money collected on a parcel delivered an hour ago is still in
/// the rider's pocket until they hand it over.
final codHoldingProvider = FutureProvider.autoDispose<RiderCodHolding>(
  (ref) => ref.watch(parcelsRepositoryProvider).codHolding(),
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
  bool _scanningAccept = false;
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
    ref.invalidate(codHoldingProvider);
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

  /// Opens the full at-the-door flow rather than the one-field
  /// AlertDialog this used to be. That dialog could only express
  /// success: there was no way to record a failed attempt, no proof of
  /// who took the parcel, and no way to leave it somewhere the receiver
  /// could collect it — see CompleteDeliveryScreen's own comment.
  /// "Send it on the bus you ride" at the point of use — a conductor
  /// putting a parcel they already hold into the boot of the vehicle
  /// they're crewing. Offered on every held parcel rather than gated on
  /// a pre-fetched trip: the screen behind it explains clearly when the
  /// person isn't on a running trip, which beats a button that silently
  /// isn't there for reasons nobody can see.
  Future<void> _loadOnBus(ParcelRow row) async {
    final boarded = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => LoadOnBusScreen(parcel: row)),
    );
    if (boarded == true) ref.invalidate(heldParcelsProvider);
  }

  Future<void> _completeDelivery(ParcelRow row) async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => CompleteDeliveryScreen(parcel: row)),
    );
    if (done == true) {
      ref.invalidate(heldParcelsProvider);
      ref.invalidate(codHoldingProvider);
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
                          // parcelStatusLabel, never the raw enum — this
                          // list used to render "PKG-X · IN_TRANSIT"
                          // while the detail screen one tap away showed
                          // a written sentence about the same parcel.
                          return EsokoListTile(
                            title: '${p.originLabel} → ${p.destinationLabel}',
                            subtitle: '${p.code} · '
                                '${parcelStatusLabel(p.status)} · '
                                '${parcelHumanTime(p.createdAt)}',
                            icon: _statusIcon(p.status),
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
                              child: EsokoField.code(
                                controller: _acceptCodeController,
                                label: 'Accept a parcel',
                                hint: 'PKG-XXXXXXX',
                                onSubmitted: (_) => _acceptParcel(),
                              ),
                            ),
                            const SizedBox(width: EsokoSpacing.s2),
                            // Scanning belongs here more than anywhere:
                            // taking custody is the single most repeated
                            // action a courier performs, and it was the
                            // one place in the whole product that still
                            // made them type PKG-XXXXXXX by hand while
                            // the public web tracker had a QR scanner.
                            SizedBox(
                              width: 52,
                              child: IconButton.filledTonal(
                                onPressed: () =>
                                    setState(() => _scanningAccept = !_scanningAccept),
                                icon: Icon(_scanningAccept
                                    ? Icons.close
                                    : Icons.qr_code_scanner),
                                tooltip: _scanningAccept
                                    ? 'Close scanner'
                                    : 'Scan a parcel',
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
                              child: EsokoButton.primary(
                                expand: false,
                                label: 'Accept',
                                loading: _acceptBusy,
                                onPressed: _acceptParcel,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // A rider carrying somebody else's cash should
                      // never have to go looking for the total. Hidden
                      // entirely at zero rather than shown as "KES 0" —
                      // most riders never touch COD, and a permanent
                      // empty money row is noise on their main screen.
                      const _CodFloatBanner(),
                      if (_scanningAccept)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                            EsokoSpacing.s4, 0, EsokoSpacing.s4, EsokoSpacing.s4,
                          ),
                          child: SizedBox(
                            height: 200,
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(EsokoRadius.md),
                              child: MobileScanner(
                                onDetect: (cap) {
                                  final v = cap.barcodes.firstOrNull?.rawValue;
                                  if (v == null || _acceptBusy) return;
                                  setState(() {
                                    _acceptCodeController.text =
                                        v.trim().toUpperCase();
                                    _scanningAccept = false;
                                  });
                                  _acceptParcel();
                                },
                              ),
                            ),
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
                                // Attempt count leads the subtitle when
                                // there is one: ListParcelsHeld sorts
                                // these to the top precisely because a
                                // parcel that has already failed twice
                                // is the one that needs a decision, not
                                // another silent lap in the bag.
                                final cod = p.needsCodCollection
                                    ? 'COLLECT KES ${p.codExpectedKes.format()} · '
                                    : '';
                                final detail = p.deliveryAttempts > 0
                                    ? '${p.deliveryAttempts} failed '
                                        '${p.deliveryAttempts == 1 ? 'try' : 'tries'} · '
                                        'to ${p.receiverName}'
                                    : 'to ${p.receiverName}';
                                return EsokoListTile(
                                  title:
                                      '${p.originLabel} → ${p.destinationLabel}',
                                  // The amount to collect leads, ahead
                                  // of everything else: it is the one
                                  // thing a courier must know before
                                  // they knock, and finding it out
                                  // afterwards is finding it out too
                                  // late.
                                  subtitle: '${p.code} · $cod$detail',
                                  icon: _statusIcon(p.status),
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
                                  // Two actions now (finish, or load onto
                                  // a bus), so the trailing slot is a
                                  // menu rather than a button. Still
                                  // fixed-width — see SCREEN_CONVENTIONS
                                  // .md: an unconstrained widget in
                                  // `trailing` renders as a silently
                                  // blank tile once title+subtitle get
                                  // long, which a real route label plus
                                  // a COD amount easily does.
                                  trailing: SizedBox(
                                    width: 48,
                                    child: PopupMenuButton<String>(
                                      tooltip: 'Actions',
                                      onSelected: (v) {
                                        if (v == 'finish') _completeDelivery(p);
                                        if (v == 'bus') _loadOnBus(p);
                                      },
                                      itemBuilder: (_) => const [
                                        PopupMenuItem(
                                          value: 'finish',
                                          // "Finish" rather than
                                          // "Deliver": the screen behind
                                          // it covers a failed attempt
                                          // and an agent drop too, and a
                                          // courier who couldn't deliver
                                          // must not have to press
                                          // "Deliver" to say so.
                                          child: Text('Finish delivery'),
                                        ),
                                        PopupMenuItem(
                                          value: 'bus',
                                          child: Text('Load on my bus'),
                                        ),
                                      ],
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
                    onOpenEarnings: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const CourierEarningsScreen(),
                      ),
                    ),
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

/// What this rider is holding in cash right now.
class _CodFloatBanner extends ConsumerWidget {
  const _CodFloatBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final holding = ref.watch(codHoldingProvider);
    return holding.maybeWhen(
      data: (h) {
        if (!h.amountKes.isPositive) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.fromLTRB(
            EsokoSpacing.s4, 0, EsokoSpacing.s4, EsokoSpacing.s3,
          ),
          child: EsokoInlineNotice(
            color: EsokoColors.navy,
            icon: EsokoIconName.coins,
            message: 'You are holding KES ${h.amountKes.format()} '
                'from ${h.parcelCount} '
                '${h.parcelCount == 1 ? 'parcel' : 'parcels'}. '
                'Hand it in at the end of your round.',
          ),
        );
      },
      // A failed or pending fetch shows nothing at all: a wrong cash
      // figure on a courier's screen is worse than no figure.
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// One glyph per lifecycle state, so a list scan reads at a glance —
/// the off-timeline states in particular (a failed attempt, a parcel on
/// a shop shelf) must not look identical to a healthy in-transit one.
IconData _statusIcon(String status) => switch (status) {
      'DRAFT_PENDING_PAYMENT' => Icons.pending_outlined,
      'FAILED_DELIVERY' => Icons.report_problem_outlined,
      'HELD_AT_AGENT' => Icons.storefront_outlined,
      'DELIVERED' => Icons.check_circle_outline,
      'RETURNED_TO_SENDER' => Icons.keyboard_return_outlined,
      'CANCELLED' => Icons.cancel_outlined,
      _ => Icons.local_shipping_outlined,
    };

/// BOOKED, unassigned parcels near this courier's last posted ping —
/// the gig/on-demand claim flow (see this screen's own doc comment).
/// Location is opt-in per visit, same "Use my location" tap
/// store_list_screen.dart already asks for — nothing pings silently in
/// the background before someone's actually looking at this tab.
class _NearbyJobsTab extends StatelessWidget {
  const _NearbyJobsTab({
    required this.onOpenEarnings,
    required this.jobs,
    required this.position,
    required this.locating,
    required this.locationError,
    required this.claimingCode,
    required this.onUseLocation,
    required this.onClaim,
  });

  final VoidCallback onOpenEarnings;
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
              EsokoButton.primary(
                expand: false,
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
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            EsokoSpacing.s4, EsokoSpacing.s3, EsokoSpacing.s4, 0,
          ),
          child: EsokoButton.secondary(
            label: 'Your earnings',
            icon: Icons.payments_outlined,
            onPressed: onOpenEarnings,
          ),
        ),
        Expanded(child: _jobsList()),
      ],
    );
  }

  Widget _jobsList() {
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
              child: EsokoButton.primary(
                expand: false,
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
