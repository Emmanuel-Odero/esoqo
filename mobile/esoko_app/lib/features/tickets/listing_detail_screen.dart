import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/providers.dart';
import '../../core/theme/esoko_tokens.dart';
import 'schedule_booking_screen.dart';
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
      appBar: AppBar(title: Text(listing.valueOrNull?.title ?? 'Listing')),
      body: listing.when(
        data: (l) => ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s4),
          children: [
            if (l.venueOrRouteLabel != null)
              Text(l.venueOrRouteLabel!, style: TextStyle(color: EsokoColors.text2)),
            if (l.description != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              Text(l.description!),
            ],
            const SizedBox(height: EsokoSpacing.s5),
            Text('Ticket types', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: EsokoSpacing.s2),
            for (final tc in l.ticketClasses)
              Padding(
                padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
                child: Row(
                  children: [
                    Expanded(child: Text('${tc.name}${tc.seated ? ' (seated)' : ''}')),
                    Text('KES ${tc.priceKes}', style: TextStyle(color: EsokoColors.green)),
                  ],
                ),
              ),
            const SizedBox(height: EsokoSpacing.s5),
            Text(l.isTransport ? 'Departures' : 'Showtimes', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: EsokoSpacing.s2),
            if (l.schedules.isEmpty)
              Text('No upcoming dates.', style: TextStyle(color: EsokoColors.text2))
            else
              for (final s in l.schedules)
                Card(
                  child: ListTile(
                    leading: Icon(Icons.event_outlined, color: EsokoColors.blue),
                    title: Text(s.departAt),
                    subtitle: s.gateInfo != null ? Text(s.gateInfo!) : null,
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => ScheduleBookingScreen(scheduleId: s.id, ticketClasses: l.ticketClasses, listingTitle: l.title),
                    )),
                  ),
                ),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load that listing.', style: TextStyle(color: EsokoColors.red))),
      ),
    );
  }
}
