import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'category_style.dart';
import 'gradient_thumb.dart';
import 'shopping_models.dart';
import 'store_detail_screen.dart';

final storesProvider = FutureProvider.autoDispose<List<StoreSummary>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/stores');
  final list = (res['stores'] as List?) ?? const [];
  return list.map((e) => StoreSummary.fromJson(e as Map<String, dynamic>)).toList();
});

typedef _NearbyQuery = ({double? lat, double? lng, String q});

/// GET /v1/stores/nearby — covers both click-and-collect discovery
/// modes: pass lat/lng for a GPS-sorted "near me" search, or just q for
/// a neighborhood-text search. See dbx.ListStoresNearby's own comment.
final nearbyStoresProvider = FutureProvider.autoDispose.family<List<NearbyStore>, _NearbyQuery>((ref, query) async {
  final api = ref.watch(apiClientProvider);
  final params = <String, String>{
    if (query.lat != null) 'lat': query.lat!.toStringAsFixed(6),
    if (query.lng != null) 'lng': query.lng!.toStringAsFixed(6),
    if (query.q.isNotEmpty) 'q': query.q,
  };
  final qs = params.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
  final res = await api.get('/v1/stores/nearby${qs.isEmpty ? '' : '?$qs'}');
  final list = (res['stores'] as List?) ?? const [];
  return list.map((e) => NearbyStore.fromJson(e as Map<String, dynamic>)).toList();
});

/// Shopping tab home. Defaults to the plain store directory; a
/// "Use my location" chip switches to GET /v1/stores/nearby's
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
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() {
          _locationError = 'Location permission denied — search by neighborhood instead.';
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
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      setState(() {
        _position = position;
        _locating = false;
      });
    } catch (_) {
      setState(() {
        _locationError = 'Could not get your location — search by neighborhood instead.';
        _locating = false;
      });
    }
  }

  bool get _searching => _position != null || _query.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final query = (lat: _position?.latitude, lng: _position?.longitude, q: _query);
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
      child: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Shop the market', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: EsokoSpacing.s1),
                  Text(
                    'Shop from home, then collect once it\'s ready — or browse goods, produce and services from stores across Esoko.',
                    style: TextStyle(color: EsokoColors.text2),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search by neighbourhood or store — "Kilimani"',
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: _query.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded),
                              onPressed: () => setState(() {
                                _searchController.clear();
                                _query = '';
                              }),
                            )
                          : null,
                    ),
                    onChanged: (v) => setState(() => _query = v.trim()),
                  ),
                  const SizedBox(height: EsokoSpacing.s3),
                  Wrap(
                    spacing: EsokoSpacing.s2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      ChoiceChip(
                        label: Text(_position != null ? 'Using your location' : 'Use my location'),
                        avatar: _locating
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                            : Icon(_position != null ? Icons.my_location_rounded : Icons.location_searching_rounded, size: 16),
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
                        Text('Sorted by distance', style: TextStyle(fontSize: 12, color: EsokoColors.text2)),
                    ],
                  ),
                  if (_locationError != null) ...[
                    const SizedBox(height: EsokoSpacing.s2),
                    Text(_locationError!, style: TextStyle(fontSize: 12, color: EsokoColors.red)),
                  ],
                ],
              ),
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: EsokoSpacing.s2)),
          if (_searching)
            nearby.when(
              data: (list) => list.isEmpty
                  ? SliverToBoxAdapter(child: _EmptyState(message: 'No stores match — try a different search.'))
                  : _storeListSliver(list),
              loading: () => const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(EsokoSpacing.s8), child: Center(child: CircularProgressIndicator()))),
              error: (e, _) => SliverToBoxAdapter(child: _EmptyState(message: 'Could not search stores. Pull to retry.')),
            )
          else
            plain.when(
              data: (list) => list.isEmpty
                  ? SliverToBoxAdapter(child: _EmptyState(message: 'No stores are open yet.'))
                  : _storeListSliver(list),
              loading: () => const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(EsokoSpacing.s8), child: Center(child: CircularProgressIndicator()))),
              error: (e, _) => SliverToBoxAdapter(child: _EmptyState(message: 'Could not load stores. Pull to retry.')),
            ),
          const SliverToBoxAdapter(child: SizedBox(height: EsokoSpacing.s6)),
        ],
      ),
    );
  }

  Widget _storeListSliver(List<StoreSummary> list) {
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(EsokoSpacing.s4, EsokoSpacing.s2, EsokoSpacing.s4, EsokoSpacing.s2),
      sliver: SliverList.separated(
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
        itemBuilder: (context, i) => _StoreCard(store: list[i]),
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
    final distance = store is NearbyStore ? (store as NearbyStore).distanceKm : null;
    return Material(
      color: Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => StoreDetailScreen(slug: store.slug)),
        ),
        child: Container(
          decoration: BoxDecoration(border: Border.all(color: EsokoColors.line)),
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 64,
                height: 64,
                child: GradientThumb(
                  category: store.primaryCategory,
                  borderRadius: BorderRadius.circular(EsokoRadius.md),
                  iconSize: 28,
                ),
              ),
              const SizedBox(width: EsokoSpacing.s4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(store.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    const SizedBox(height: EsokoSpacing.s1),
                    if (store.neighborhood != null || distance != null)
                      Text(
                        [
                          if (distance != null) '${_formatDistance(distance)} away',
                          if (store.neighborhood != null) store.neighborhood!,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: EsokoColors.text2, fontSize: 12),
                      )
                    else if (store.tagline != null)
                      Text(store.tagline!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: EsokoColors.text2)),
                    const SizedBox(height: EsokoSpacing.s2),
                    if (store.primaryCategory != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: EsokoSpacing.s2, vertical: 3),
                        decoration: BoxDecoration(
                          color: style.gradient.last.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(EsokoRadius.pill),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(style.icon, size: 12, color: style.gradient.last),
                            const SizedBox(width: 4),
                            Text(store.primaryCategory!, style: TextStyle(fontSize: 11, color: style.gradient.last, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: EsokoColors.text3),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDistance(double km) => km < 1 ? '${(km * 1000).round()} m' : '${km.toStringAsFixed(1)} km';
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(EsokoSpacing.s8),
      child: Column(
        children: [
          Icon(Icons.storefront_outlined, size: 40, color: EsokoColors.text3),
          const SizedBox(height: EsokoSpacing.s3),
          Center(child: Text(message, style: TextStyle(color: EsokoColors.text2))),
        ],
      ),
    );
  }
}
