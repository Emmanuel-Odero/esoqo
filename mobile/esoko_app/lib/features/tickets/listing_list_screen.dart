import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'listing_detail_screen.dart';
import 'my_tickets_screen.dart';
import 'ticket_style.dart';
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
              : CustomScrollView(
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s5, EsokoSpacing.s2),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Travel & events', style: Theme.of(context).textTheme.headlineSmall),
                            const SizedBox(height: EsokoSpacing.s1),
                            Text('Book a seat or a ticket, pay by M-Pesa.', style: TextStyle(color: EsokoColors.text2)),
                          ],
                        ),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(EsokoSpacing.s4, EsokoSpacing.s2, EsokoSpacing.s4, EsokoSpacing.s9),
                      sliver: SliverList.separated(
                        itemCount: list.length,
                        separatorBuilder: (_, _) => const SizedBox(height: EsokoSpacing.s3),
                        itemBuilder: (context, i) => _ListingCard(listing: list[i]),
                      ),
                    ),
                  ],
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
        child: Column(
          children: [
            Icon(Icons.confirmation_num_outlined, size: 40, color: EsokoColors.text3),
            const SizedBox(height: EsokoSpacing.s3),
            Center(child: Text(message, style: TextStyle(color: EsokoColors.text2))),
          ],
        ),
      );
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({required this.listing});
  final ListingSummary listing;

  @override
  Widget build(BuildContext context) {
    final style = TicketStyle.forVertical(listing.vertical);
    return Material(
      color: Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ListingDetailScreen(listingId: listing.id)),
        ),
        child: Container(
          decoration: BoxDecoration(border: Border.all(color: EsokoColors.line)),
          child: Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: style.gradient, begin: Alignment.topLeft, end: Alignment.bottomRight),
                  ),
                ),
              ),
              Positioned(
                right: -14,
                bottom: -14,
                child: Icon(style.icon, size: 96, color: Colors.white.withValues(alpha: 0.14)),
              ),
              Padding(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.22),
                        borderRadius: BorderRadius.circular(EsokoRadius.pill),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(style.icon, size: 12, color: Colors.white),
                          const SizedBox(width: 4),
                          Text(
                            listing.isTransport ? 'TRANSPORT' : 'EVENT',
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: 0.5),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: EsokoSpacing.s3),
                    Text(
                      listing.title,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                    ),
                    if (listing.venueOrRouteLabel != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(listing.isTransport ? Icons.route_outlined : Icons.place_outlined, size: 14, color: Colors.white70),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(listing.venueOrRouteLabel!, style: const TextStyle(color: Colors.white70, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: EsokoSpacing.s3),
                    if (listing.fromPriceKes != null)
                      Row(
                        children: [
                          Text('from ', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 12)),
                          Text('KES ${listing.fromPriceKes}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
