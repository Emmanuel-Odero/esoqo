import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'listing_detail_screen.dart';
import 'my_tickets_screen.dart';
import 'ticketing_models.dart';

final listingsProvider = FutureProvider.autoDispose<List<ListingSummary>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/listings');
  final list = (res['listings'] as List?) ?? const [];
  return list.map((e) => ListingSummary.fromJson(e as Map<String, dynamic>)).toList();
});

/// Tickets tab home — GET /v1/listings (events + transport), with a
/// shortcut to "My tickets" (GET /v1/me/tickets, authenticated).
class ListingListScreen extends ConsumerWidget {
  const ListingListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listings = ref.watch(listingsProvider);
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(listingsProvider),
        child: listings.when(
          data: (list) => list.isEmpty
              ? ListView(children: [_empty('No listings are open yet.')])
              : ListView.separated(
                  padding: const EdgeInsets.all(EsokoSpacing.s4),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                  itemBuilder: (context, i) {
                    final listing = list[i];
                    return Card(
                      child: ListTile(
                        leading: Icon(
                          listing.isTransport ? Icons.directions_bus_outlined : Icons.confirmation_num_outlined,
                          color: EsokoColors.blue,
                        ),
                        title: Text(listing.title),
                        subtitle: Text(listing.venueOrRouteLabel ?? ''),
                        trailing: listing.fromPriceKes != null
                            ? Text('from KES ${listing.fromPriceKes}', style: TextStyle(color: EsokoColors.green))
                            : null,
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => ListingDetailScreen(listingId: listing.id)),
                        ),
                      ),
                    );
                  },
                ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [_empty('Could not load listings. Pull to retry.')]),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyTicketsScreen())),
        icon: const Icon(Icons.confirmation_num_outlined),
        label: const Text('My tickets'),
      ),
    );
  }

  Widget _empty(String message) => Padding(
        padding: const EdgeInsets.all(EsokoSpacing.s8),
        child: Center(child: Text(message, style: TextStyle(color: EsokoColors.text2))),
      );
}
