import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'category_style.dart';
import 'gradient_thumb.dart';
import 'order_detail_screen.dart';
import 'shopping_models.dart';
import 'store_detail_screen.dart';
import 'stores_repository.dart';

final storesProvider = FutureProvider.autoDispose<List<StoreSummary>>((
  ref,
) async {
  return ref.watch(storesRepositoryProvider).directory();
});

/// GET /v1/me/saved-stores — "My spots". Only ever watched from a
/// signed-in context (see _MySpotsSection and StoreDetailScreen's save
/// star) — a guest never fires this request in the first place, rather
/// than firing it and swallowing the resulting 401.
final savedStoresProvider = FutureProvider.autoDispose<List<SavedStore>>((
  ref,
) {
  return ref.watch(storesRepositoryProvider).savedStores();
});

/// GET /v1/me/orders — every order ever placed. Watched here only for
/// _ReadyForPickupSection's filter; the full history has no screen of
/// its own yet (see that section's doc comment).
final myOrdersProvider = FutureProvider.autoDispose<List<OrderStatus>>((
  ref,
) {
  return ref.watch(storesRepositoryProvider).myOrders();
});

typedef _NearbyQuery = ({double? lat, double? lng, String q});

/// GET /v1/stores/nearby — covers both click-and-collect discovery
/// modes: pass lat/lng for a GPS-sorted "near me" search, or just q for
/// a neighborhood-text search. See dbx.ListStoresNearby's own comment.
final nearbyStoresProvider = FutureProvider.autoDispose
    .family<List<NearbyStore>, _NearbyQuery>((ref, query) async {
      return ref
          .watch(storesRepositoryProvider)
          .nearby(lat: query.lat, lng: query.lng, q: query.q);
    });

/// Shopping tab home. Defaults to the plain store directory; a
/// "Use current location" chip switches to GET /v1/stores/nearby's
/// GPS-distance mode, and the search field switches it to
/// neighborhood-text mode — both degrade gracefully back to the plain
/// list when cleared/denied, so browsing everything never regresses.
class StoreListScreen extends ConsumerStatefulWidget {
  const StoreListScreen({super.key});

  @override
  ConsumerState<StoreListScreen> createState() => _StoreListScreenState();
}

class _StoreListScreenState extends ConsumerState<StoreListScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  Position? _position;
  bool _locating = false;
  String? _locationError;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _useMyLocation() async {
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
          _locationError =
              'Location permission denied — search by neighborhood instead.';
          _locating = false;
        });
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() {
          _locationError = 'Turn on location services to find stores near you.';
          _locating = false;
        });
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
        ),
      );
      setState(() {
        _position = position;
        _locating = false;
      });
    } catch (_) {
      setState(() {
        _locationError =
            'Could not get your location — search by neighborhood instead.';
        _locating = false;
      });
    }
  }

  bool get _searching => _position != null || _query.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final query = (
      lat: _position?.latitude,
      lng: _position?.longitude,
      q: _query,
    );
    final nearby = ref.watch(nearbyStoresProvider(query));
    final plain = ref.watch(storesProvider);

    return RefreshIndicator(
      onRefresh: () async {
        if (_searching) {
          ref.invalidate(nearbyStoresProvider(query));
        } else {
          ref.invalidate(storesProvider);
        }
      },
      // Tablet-decent: cap the column at 840 (M3 expanded) so the list
      // doesn't stretch edge-to-edge on large windows. No-op on phones.
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s2,
                  ),
                  child: EsoqoPageLead(
                    'Shop from home, then collect once it\'s ready — or browse goods, produce and services from stores across Esoqo.',
                  ),
                ),
              ),
              if (ref.watch(authControllerProvider) is AuthSignedIn) ...[
                const SliverToBoxAdapter(child: _ReadyForPickupSection()),
                const SliverToBoxAdapter(child: _MySpotsSection()),
              ],
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: EsoqoSpacing.s5,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      EsoqoSearchField(
                        controller: _searchController,
                        hint: 'Search by neighbourhood or store — "Kilimani"',
                        debounce: const Duration(milliseconds: 350),
                        onChanged: (v) => setState(() => _query = v.trim()),
                      ),
                      const SizedBox(height: EsoqoSpacing.s3),
                      Wrap(
                        spacing: EsoqoSpacing.s2,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          ChoiceChip(
                            label: Text(
                              _position != null
                                  ? 'Using your location'
                                  : 'Use current location',
                            ),
                            avatar: _locating
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : Icon(
                                    _position != null
                                        ? Icons.my_location_rounded
                                        : Icons.location_searching_rounded,
                                    size: 16,
                                  ),
                            selected: _position != null,
                            onSelected: (_) {
                              if (_position != null) {
                                setState(() => _position = null);
                              } else {
                                _useMyLocation();
                              }
                            },
                          ),
                          if (_position != null)
                            Text(
                              'Sorted by distance',
                              style: TextStyle(
                                fontSize: EsoqoTypeScale.labelSmall,
                                color: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.color,
                              ),
                            ),
                        ],
                      ),
                      if (_locationError != null)
                        EsoqoFormError(message: _locationError!),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(
                child: SizedBox(height: EsoqoSpacing.s2),
              ),
              if (_searching)
                EsoqoSliverAsyncView(
                  value: nearby,
                  isEmpty: (list) => list.isEmpty,
                  emptyMessage: 'No stores match — try a different search.',
                  emptyIcon: Icons.storefront_outlined,
                  onRetry: () => ref.invalidate(nearbyStoresProvider(query)),
                  data: (context, list) => [_storeListSliver(list)],
                )
              else
                EsoqoSliverAsyncView(
                  value: plain,
                  isEmpty: (list) => list.isEmpty,
                  emptyMessage: 'No stores are open yet.',
                  emptyIcon: Icons.storefront_outlined,
                  onRetry: () => ref.invalidate(storesProvider),
                  data: (context, list) => [_storeListSliver(list)],
                ),
              const SliverToBoxAdapter(
                child: SizedBox(height: EsoqoSpacing.s6),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _storeListSliver(List<StoreSummary> list) {
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        EsoqoSpacing.s4,
        EsoqoSpacing.s2,
        EsoqoSpacing.s4,
        EsoqoSpacing.s2,
      ),
      sliver: SliverList.separated(
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: EsoqoSpacing.s3),
        itemBuilder: (context, i) => EsoqoStagger(
          index: i,
          child: _StoreCard(store: list[i]),
        ),
      ),
    );
  }
}

class _StoreCard extends StatelessWidget {
  const _StoreCard({required this.store});
  final StoreSummary store;

  @override
  Widget build(BuildContext context) {
    final style = CategoryStyle.forCategory(store.primaryCategory);
    final distance = store is NearbyStore
        ? (store as NearbyStore).distanceKm
        : null;
    return EsoqoCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => StoreDetailScreen(slug: store.slug)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Hero(
            tag: 'store-hero-${store.slug}',
            child: Material(
              color: Colors.transparent,
              child: SizedBox(
                width: 64,
                height: 64,
                child: GradientThumb(
                  category: store.primaryCategory,
                  borderRadius: BorderRadius.circular(EsoqoRadius.md),
                  iconSize: 28,
                ),
              ),
            ),
          ),
          const SizedBox(width: EsoqoSpacing.s4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  store.name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: EsoqoTypeScale.subTitle,
                  ),
                ),
                const SizedBox(height: EsoqoSpacing.s1),
                if (store.neighborhood != null || distance != null)
                  Text(
                    [
                      if (distance != null) '${_formatDistance(distance)} away',
                      if (store.neighborhood != null) store.neighborhood!,
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Theme.of(context).textTheme.bodySmall?.color,
                      fontSize: EsoqoTypeScale.labelSmall,
                    ),
                  )
                else if (store.tagline != null)
                  Text(
                    store.tagline!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Theme.of(context).textTheme.bodySmall?.color,
                    ),
                  ),
                const SizedBox(height: EsoqoSpacing.s2),
                if (store.primaryCategory != null)
                  EsoqoStatusPill(
                    label: store.primaryCategory!,
                    color: style.gradient.last,
                    icon: style.icon,
                  ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right_rounded,
            color: Theme.of(context).textTheme.bodySmall?.color,
          ),
        ],
      ),
    );
  }

  String _formatDistance(double km) =>
      km < 1 ? '${(km * 1000).round()} m' : '${km.toStringAsFixed(1)} km';
}

/// An order sitting on a shelf with your name on it — the proposal's
/// "lead with ready-to-collect": of everything this screen could open
/// with, a physical thing already paid for and waiting is the one
/// thing actually worth a special trip before you go browsing for
/// anything else. GET /v1/me/orders was already modelled on the
/// client (see [OrderStatus]'s own doc comment) but nothing had called
/// it — this is that call, filtered to the one status that means
/// "go get it".
///
/// Renders nothing outside that state, same "nothing until it's real"
/// rule as [_MySpotsSection] below.
class _ReadyForPickupSection extends ConsumerWidget {
  const _ReadyForPickupSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(myOrdersProvider).valueOrNull;
    if (orders == null) return const SizedBox.shrink();
    final ready = orders.where((o) => o.status == 'READY_FOR_PICKUP').toList();
    if (ready.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EsoqoSpacing.s5,
        0,
        EsoqoSpacing.s5,
        EsoqoSpacing.s4,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const EsoqoSubHeader('Ready for pickup'),
          const SizedBox(height: EsoqoSpacing.s2),
          for (var i = 0; i < ready.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
              child: EsoqoStagger(
                index: i,
                child: EsoqoAttentionCard(
                  when: ready[i].pickupCode == null
                      ? 'Ready now'
                      : 'Code ${ready[i].pickupCode}',
                  title: ready[i].storeName,
                  amountKes: ready[i].totalKes,
                  detail: 'Tap to show the code',
                  accent: EsoqoColors.green,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => OrderDetailScreen(orderId: ready[i].id),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "Your spots" — renders nothing at all for someone with no saved
/// stores, same reasoning as YourTicketsBody's payment-plans section
/// (Phase 4): this exists for the minority who've actually used it, not
/// as a permanent fixture everyone scrolls past on every visit.
class _MySpotsSection extends ConsumerWidget {
  const _MySpotsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saved = ref.watch(savedStoresProvider);
    final list = saved.valueOrNull;
    if (list == null || list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EsoqoSpacing.s5,
        0,
        EsoqoSpacing.s5,
        EsoqoSpacing.s4,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const EsoqoSubHeader('Your spots'),
          const SizedBox(height: EsoqoSpacing.s2),
          for (var i = 0; i < list.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: EsoqoSpacing.s3),
              child: EsoqoStagger(index: i, child: _StoreCard(store: list[i])),
            ),
        ],
      ),
    );
  }
}
