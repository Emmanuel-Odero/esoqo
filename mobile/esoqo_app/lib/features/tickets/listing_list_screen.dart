import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'listing_detail_screen.dart';
import 'my_tickets_screen.dart';
import 'ticket_style.dart';
import 'ticketing_models.dart';
import 'ticketing_repository.dart';

final listingsProvider = FutureProvider.autoDispose<List<ListingSummary>>(
  (ref) => ref.watch(ticketingRepositoryProvider).listings(),
);

/// Tickets tab home — GET /v1/listings (events + transport) and
/// GET /v1/me/tickets (authenticated), as two segments of one screen
/// rather than a list with a button to a separate one. A booking
/// mid-instalment used to be findable only by first opening Browse,
/// finding the button, then opening a second screen — three steps to
/// see money you already owe.
class ListingListScreen extends ConsumerStatefulWidget {
  const ListingListScreen({super.key});

  @override
  ConsumerState<ListingListScreen> createState() => _ListingListScreenState();
}

class _ListingListScreenState extends ConsumerState<ListingListScreen> {
  int _segment = 0;

  @override
  Widget build(BuildContext context) {
    final listings = ref.watch(listingsProvider);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s5,
                    EsoqoSpacing.s3,
                  ),
                  child: EsoqoSegmentedToggle<int>(
                    selected: _segment,
                    onChanged: (v) => setState(() => _segment = v),
                    options: const [
                      (0, 'Browse'),
                      (1, 'Your tickets'),
                    ],
                  ),
                ),
                Expanded(
                  child: _segment == 0
                      ? _BrowseBody(listings: listings, ref: ref)
                      : const YourTicketsBody(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BrowseBody extends StatelessWidget {
  const _BrowseBody({required this.listings, required this.ref});
  final AsyncValue<List<ListingSummary>> listings;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(listingsProvider),
      child: EsoqoAsyncView(
        value: listings,
        isEmpty: (list) => list.isEmpty,
        emptyMessage: 'No listings are open yet.',
        emptyIcon: Icons.confirmation_num_outlined,
        onRetry: () => ref.invalidate(listingsProvider),
        data: (context, list) => CustomScrollView(
          slivers: [
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  EsoqoSpacing.s5,
                  0,
                  EsoqoSpacing.s5,
                  EsoqoSpacing.s2,
                ),
                child: EsoqoPageLead('Book a seat or a ticket, pay by M-Pesa.'),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(EsoqoSpacing.s4, EsoqoSpacing.s2, EsoqoSpacing.s4, EsoqoSpacing.s9),
              sliver: SliverList.separated(
                itemCount: list.length,
                separatorBuilder: (_, _) => const SizedBox(height: EsoqoSpacing.s3),
                itemBuilder: (context, i) => EsoqoStagger(index: i, child: _ListingCard(listing: list[i])),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({required this.listing});
  final ListingSummary listing;

  @override
  Widget build(BuildContext context) {
    final style = TicketStyle.forVertical(listing.vertical);
    // EsoqoCard (not a hand-rolled Material+InkWell) so the tile gets
    // the shared press scale-down + haptic for free. Padding is zeroed
    // because the gradient art runs full-bleed inside the card bounds.
    return EsoqoCard(
      padding: EdgeInsets.zero,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ListingDetailScreen(listingId: listing.id)),
      ),
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
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.22),
                        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(style.icon, size: 12, color: Colors.white),
                          const SizedBox(width: 4),
                          Text(
                            listing.isTransport ? 'TRANSPORT' : 'EVENT',
                            style: EsoqoTypography.eyebrow(color: Colors.white),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: EsoqoSpacing.s3),
                    Text(
                      listing.title,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: EsoqoTypeScale.subTitle),
                    ),
                    if (listing.venueOrRouteLabel != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(listing.isTransport ? Icons.route_outlined : Icons.place_outlined, size: 14, color: Colors.white70),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(listing.venueOrRouteLabel!, style: const TextStyle(color: Colors.white70, fontSize: EsoqoTypeScale.labelSmall), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: EsoqoSpacing.s3),
                    if (listing.fromPriceKes != null)
                      Row(
                        children: [
                          Text('from ', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: EsoqoTypeScale.labelSmall)),
                          Text('KES ${listing.fromPriceKes}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                        ],
                      ),
                  ],
                ),
              ),
            ],
          ),
    );
  }
}
