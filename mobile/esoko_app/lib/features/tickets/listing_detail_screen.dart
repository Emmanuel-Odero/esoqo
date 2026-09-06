import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'schedule_booking_screen.dart';
import 'ticket_style.dart';
import 'ticketing_models.dart';
import 'ticketing_repository.dart';

final listingDetailProvider = FutureProvider.autoDispose.family<ListingDetail, String>(
  (ref, id) => ref.watch(ticketingRepositoryProvider).listing(id),
);

class ListingDetailScreen extends ConsumerWidget {
  const ListingDetailScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listing = ref.watch(listingDetailProvider(listingId));
    return Scaffold(
      body: EsokoAsyncView(
        value: listing,
        onRetry: () => ref.invalidate(listingDetailProvider(listingId)),
        data: (context, l) {
          final style = TicketStyle.forVertical(l.vertical);
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(listingDetailProvider(listingId)),
            child: CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 170,
                pinned: true,
                backgroundColor: style.gradient.last,
                foregroundColor: Colors.white,
                flexibleSpace: FlexibleSpaceBar(
                  // Same trap as store_detail: explicit style needs an
                  // explicit white, foregroundColor doesn't reach it.
                  title: Text(l.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white)),
                  background: Stack(
                    fit: StackFit.expand,
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(colors: style.gradient, begin: Alignment.topLeft, end: Alignment.bottomRight),
                        ),
                      ),
                      Positioned(right: -20, bottom: -10, child: Icon(style.icon, size: 130, color: Colors.white.withValues(alpha: 0.16))),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Colors.black.withValues(alpha: 0.0), Colors.black.withValues(alpha: 0.35)],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    if (l.venueOrRouteLabel != null)
                      Row(
                        children: [
                          Icon(l.isTransport ? Icons.route_outlined : Icons.place_outlined, size: 16, color: EsokoColors.text2),
                          const SizedBox(width: 6),
                          Text(l.venueOrRouteLabel!, style: TextStyle(color: EsokoColors.text2, fontWeight: FontWeight.w600)),
                        ],
                      ),
                    if (l.description != null) ...[
                      const SizedBox(height: EsokoSpacing.s3),
                      Text(l.description!, style: TextStyle(color: EsokoColors.text2, height: 1.5)),
                    ],
                    const SizedBox(height: EsokoSpacing.s6),
                    const EsokoSubHeader('Ticket types'),
                    const SizedBox(height: EsokoSpacing.s3),
                    for (var i = 0; i < l.ticketClasses.length; i++)
                      EsokoStagger(
                        index: i,
                        child: _TicketClassCard(ticketClass: l.ticketClasses[i], accent: style.gradient.last),
                      ),
                    const SizedBox(height: EsokoSpacing.s6),
                    EsokoSubHeader(l.isTransport ? 'Departures · ${l.schedules.length}' : 'Showtimes · ${l.schedules.length}'),
                    const SizedBox(height: EsokoSpacing.s3),
                    if (l.schedules.isEmpty)
                      const EsokoEmptyState(
                        icon: Icons.event_busy_outlined,
                        message: 'No upcoming dates — check back soon.',
                      )
                    else
                      // Indices continue past the ticket classes so the
                      // entrance cascades down the whole screen, not per
                      // section.
                      for (var j = 0; j < l.schedules.length; j++)
                        EsokoStagger(
                          index: l.ticketClasses.length + j,
                          child: _ScheduleTile(
                            schedule: l.schedules[j],
                            icon: style.icon,
                            accent: style.gradient.last,
                            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => ScheduleBookingScreen(scheduleId: l.schedules[j].id, ticketClasses: l.ticketClasses, listingTitle: l.title),
                            )),
                          ),
                        ),
                  ]),
                ),
              ),
            ],
            ),
          );
        },
      ),
    );
  }
}

class _TicketClassCard extends StatelessWidget {
  const _TicketClassCard({required this.ticketClass, required this.accent});
  final TicketClass ticketClass;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s3),
      child: EsokoListTile(
        title: ticketClass.name,
        subtitle: ticketClass.amenities.isEmpty ? null : ticketClass.amenities.join(' · '),
        icon: ticketClass.seated ? Icons.event_seat_outlined : Icons.groups_outlined,
        iconColor: accent,
        iconBackground: accent.withValues(alpha: 0.12),
        trailing: EsokoAmountText(ticketClass.priceKes, fontSize: 14),
      ),
    );
  }
}

class _ScheduleTile extends StatelessWidget {
  const _ScheduleTile({required this.schedule, required this.icon, required this.accent, required this.onTap});
  final ScheduleSummary schedule;
  final IconData icon;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: schedule.departAt,
        subtitle: schedule.gateInfo,
        icon: icon,
        iconColor: accent,
        iconBackground: accent.withValues(alpha: 0.12),
        onTap: onTap,
      ),
    );
  }
}
