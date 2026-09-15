import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/theme/esoqo_tokens.dart';
import '../../../core/widgets/widgets.dart';
import '../parcel_models.dart';

/// BOOKED, unassigned parcels near this courier's last posted ping —
/// the gig/on-demand claim flow (see this screen's own doc comment).
/// Location is opt-in per visit, same "Use current location" tap
/// store_list_screen.dart already asks for — nothing pings silently in
/// the background before someone's actually looking at this tab.
class NearbyJobsTab extends StatelessWidget {
  const NearbyJobsTab({
    super.key,
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
          padding: const EdgeInsets.all(EsoqoSpacing.s5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.near_me_outlined, size: 40),
              const SizedBox(height: EsoqoSpacing.s3),
              const Text(
                'Share your location to see jobs near you.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: EsoqoSpacing.s3),
              EsoqoButton.primary(
                expand: false,
                label: 'Use current location',
                loading: locating,
                onPressed: onUseLocation,
              ),
              if (locationError != null) ...[
                const SizedBox(height: EsoqoSpacing.s2),
                EsoqoFormError(message: locationError!),
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
            EsoqoSpacing.s4, EsoqoSpacing.s3, EsoqoSpacing.s4, 0,
          ),
          child: EsoqoButton.secondary(
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
    return EsoqoAsyncView(
      value: jobs,
      isEmpty: (l) => l.isEmpty,
      emptyMessage: 'No jobs nearby right now.',
      emptyIcon: Icons.local_shipping_outlined,
      data: (context, list) => ListView.separated(
        padding: const EdgeInsets.all(EsoqoSpacing.s4),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: EsoqoSpacing.s2),
        itemBuilder: (context, i) {
          final job = list[i];
          final subtitle = [
            job.code,
            if (job.distanceKm != null) '${job.distanceKm!.toStringAsFixed(1)} km away',
            if (job.priceKes != null) 'KES ${double.tryParse(job.priceKes!)?.toStringAsFixed(0) ?? job.priceKes}',
          ].join(' · ');
          return EsoqoListTile(
            title: '${job.originLabel} → ${job.destinationLabel}',
            subtitle: subtitle,
            icon: Icons.local_shipping_outlined,
            trailing: SizedBox(
              width: 84,
              child: EsoqoButton.primary(
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
