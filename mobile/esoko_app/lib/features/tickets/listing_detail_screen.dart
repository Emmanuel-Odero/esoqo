import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'schedule_booking_screen.dart';
import 'ticket_style.dart';
import 'ticketing_models.dart';

final listingDetailProvider = FutureProvider.autoDispose.family<ListingDetail, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/listings/$id');
  return ListingDetail.fromJson(res);
});

class ListingDetailScreen extends ConsumerWidget {
  const ListingDetailScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listing = ref.watch(listingDetailProvider(listingId));
    return Scaffold(
      body: listing.when(
        data: (l) {
          final style = TicketStyle.forVertical(l.vertical);
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 170,
                pinned: true,
                backgroundColor: style.gradient.last,
                foregroundColor: Colors.white,
                flexibleSpace: FlexibleSpaceBar(
                  title: Text(l.title, style: const TextStyle(fontSize: 15)),
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
                    Text('Ticket types', style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: EsokoSpacing.s3),
                    for (final tc in l.ticketClasses) _TicketClassCard(ticketClass: tc, accent: style.gradient.last),
                    const SizedBox(height: EsokoSpacing.s6),
                    Text(l.isTransport ? 'Departures' : 'Showtimes', style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: EsokoSpacing.s3),
                    if (l.schedules.isEmpty)
                      Text('No upcoming dates.', style: TextStyle(color: EsokoColors.text2))
                    else
                      for (final s in l.schedules)
                        _ScheduleTile(
                          schedule: s,
                          icon: style.icon,
                          accent: style.gradient.last,
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => ScheduleBookingScreen(scheduleId: s.id, ticketClasses: l.ticketClasses, listingTitle: l.title),
                          )),
                        ),
                  ]),
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load that listing.', style: TextStyle(color: EsokoColors.red))),
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
    return Container(
      margin: const EdgeInsets.only(bottom: EsokoSpacing.s3),
      padding: const EdgeInsets.all(EsokoSpacing.s4),
      decoration: BoxDecoration(border: Border.all(color: EsokoColors.line), borderRadius: BorderRadius.circular(EsokoRadius.lg)),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: accent.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(ticketClass.seated ? Icons.event_seat_outlined : Icons.groups_outlined, color: accent, size: 20),
          ),
          const SizedBox(width: EsokoSpacing.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(ticketClass.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                if (ticketClass.amenities.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(ticketClass.amenities.join(' · '), style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
                  ),
              ],
            ),
          ),
          Text('KES ${ticketClass.priceKes}', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.w800)),
        ],
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
    return Material(
      color: Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          decoration: BoxDecoration(border: Border.all(color: EsokoColors.line)),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: accent.withValues(alpha: 0.12), shape: BoxShape.circle),
                child: Icon(icon, color: accent, size: 18),
              ),
              const SizedBox(width: EsokoSpacing.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(schedule.departAt, style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (schedule.gateInfo != null) Text(schedule.gateInfo!, style: TextStyle(fontSize: 12, color: EsokoColors.text2)),
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
}
