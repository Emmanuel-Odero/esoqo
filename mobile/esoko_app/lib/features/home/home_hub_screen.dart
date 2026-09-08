import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../bills/bills_list_screen.dart';
import '../fleet/fleet_providers.dart';
import '../fleet/transport_screen.dart';
import '../groups/my_groups_screen.dart';
import '../parcels/parcels_hub_screen.dart';
import '../scan/scan_sheet.dart';
import '../shopping/store_list_screen.dart';
import '../tickets/listing_list_screen.dart';

/// The one place for the services — Shopping, Tickets, Transport,
/// Groups, Bills and Parcels all live here instead of competing for
/// bottom-nav slots. Each tile pushes its existing list screen inside
/// an [EsokoServiceScaffold] so the destination keeps a proper title
/// and back button, with the service icon hero-flying from the tile
/// into the app bar.
class HomeHubScreen extends ConsumerWidget {
  const HomeHubScreen({super.key});

  static const _services = {
    'Shopping': (
      title: 'Shopping',
      subtitle: 'Stores near you — order ahead, collect when ready.',
      icon: Icons.storefront_outlined,
      appBar: 'Shopping',
      screen: StoreListScreen(),
    ),
    'Tickets': (
      title: 'Tickets',
      subtitle: 'Events, travel and bookings in one place.',
      icon: Icons.confirmation_num_outlined,
      appBar: 'Tickets',
      screen: ListingListScreen(),
    ),
    'Transport': (
      title: 'Transport',
      subtitle: 'Pay bus fare or run your fleet.',
      icon: Icons.directions_bus_outlined,
      appBar: 'Transport',
      screen: TransportScreen(),
    ),
    'Groups': (
      title: 'Groups',
      subtitle: 'Chamas, table banking and welfare groups.',
      icon: Icons.groups_outlined,
      appBar: 'Groups',
      screen: MyGroupsScreen(),
    ),
    'Bills': (
      title: 'Bills',
      subtitle: 'Track what you owe and mark it paid.',
      icon: Icons.receipt_long_outlined,
      appBar: 'Bills',
      screen: BillsListScreen(),
    ),
    'Parcels': (
      title: 'Parcels',
      subtitle: 'Send a parcel, track it, or hand off custody.',
      icon: Icons.local_shipping_outlined,
      appBar: 'Parcels',
      screen: ParcelsHubScreen(),
    ),
  };

  /// Same six services, reordered around whatever this person is
  /// actually holding right now instead of a fixed alphabetical-feeling
  /// list — see the journey-map memo, §2. Signals used are all read-only
  /// and already fetched elsewhere in the app (no new endpoint):
  /// `fare.verify` (an unrestricted crew grant, never handed out by the
  /// SUBJECT preset's blanket `:own` capabilities — see
  /// core/auth/scan_access.dart) means crew; a non-empty `myOrgsProvider`
  /// means the person actually runs a ticketing/transport company, not
  /// just holds the structural `*.write:own` grant every subject has;
  /// a non-empty group list means they're an active group member.
  /// Ties resolve toward whichever signal is most time-pressured first
  /// (crew > runs-a-company > group member > plain subject default).
  /// Parcels has no signal of its own yet — it sits last in every
  /// order until a "parcels I'm holding" count is worth surfacing here.
  static List<String> _order({
    required bool crew,
    required bool runsOrg,
    required bool inGroup,
  }) {
    if (crew) {
      return const ['Transport', 'Bills', 'Shopping', 'Tickets', 'Groups', 'Parcels'];
    }
    if (runsOrg) {
      return const ['Transport', 'Tickets', 'Bills', 'Shopping', 'Groups', 'Parcels'];
    }
    if (inGroup) {
      return const ['Groups', 'Bills', 'Transport', 'Shopping', 'Tickets', 'Parcels'];
    }
    return const ['Transport', 'Bills', 'Shopping', 'Tickets', 'Groups', 'Parcels'];
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    final name = profile?.displayName;
    final canVerify = canVerifyFare(profile);

    // Best-effort, non-blocking: the hub renders the default order
    // immediately and only re-sorts once these resolve, rather than
    // holding the whole screen behind two extra network round-trips.
    final runsOrg = auth is AuthSignedIn
        ? (ref.watch(myOrgsProvider).valueOrNull?.isNotEmpty ?? false)
        : false;
    final inGroup = auth is AuthSignedIn
        ? (ref.watch(myGroupsProvider).valueOrNull?.isNotEmpty ?? false)
        : false;
    final order = _order(crew: canVerify, runsOrg: runsOrg, inGroup: inGroup);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        EsokoSpacing.s6,
        EsokoSpacing.s4,
        EsokoSpacing.s6,
        EsokoSpacing.s6,
      ),
      children: [
        _Greeting(
          displayName: name ?? 'Welcome back',
          esokoId: profile?.esokoId,
        ),
        const SizedBox(height: EsokoSpacing.s5),
        _ScanCta(canVerify: canVerify),
        const SizedBox(height: EsokoSpacing.s5),
        EsokoSectionHeader(
          title: 'Your services',
          subtitle: 'Everything Esoko does for you — pick where to go.',
        ),
        const SizedBox(height: EsokoSpacing.s4),
        for (final title in order)
          if (_services[title] case final service?) ...[
            Semantics(
              button: true,
              label: '${service.title}: ${service.subtitle}',
              child: EsokoListTile(
                title: service.title,
                subtitle: service.subtitle,
                leading: Hero(
                  tag: 'esoko-service-${service.title}',
                  child: EsokoQuickActionIcon(icon: service.icon),
                ),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => EsokoServiceScaffold(
                      title: service.appBar,
                      icon: service.icon,
                      heroTag: 'esoko-service-${service.title}',
                      child: service.screen,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: EsokoSpacing.s3),
          ],
      ],
    );
  }
}

/// Navy "hero" greeting card — the app's authority band (navy tokens),
/// carrying the person's name, their ESK-Id pill and the tagline. A soft
/// navy gradient + the brand's sheet shadow make the top of Home read as
/// deliberate rather than a plain list header.
class _Greeting extends StatelessWidget {
  const _Greeting({required this.displayName, this.esokoId});

  final String displayName;
  final String? esokoId;

  @override
  Widget build(BuildContext context) {
    final esokoId = this.esokoId;
    return Container(
      padding: const EdgeInsets.all(EsokoSpacing.s5),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(EsokoRadius.xl),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [EsokoColors.navy, EsokoColors.navy2],
        ),
        boxShadow: EsokoShadows.sheet,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Hello,',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.72),
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        height: 1.1,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.2),
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  displayName.characters.first.toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (esokoId != null) ...[
            const SizedBox(height: EsokoSpacing.s4),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: EsokoSpacing.s3,
                vertical: 6,
              ),
              decoration: BoxDecoration(
                color: EsokoColors.greenTint.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(EsokoRadius.pill),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.badge_outlined,
                    size: 14,
                    color: Color(0xFF7FD3A8),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    esokoId.toUpperCase(),
                    style: const TextStyle(
                      color: Color(0xFF7FD3A8),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Full-width scan action — the green "you and yours" primary, glowing
/// with the action shadow, with a mirror summary line underneath.
class _ScanCta extends StatelessWidget {
  const _ScanCta({required this.canVerify});

  final bool canVerify;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EsokoLoadingButton(
          label: canVerify ? 'Scan to pay or verify' : 'Scan to pay',
          icon: Icons.qr_code_scanner_outlined,
          onPressed: () => showScanSheet(context),
        ),
        const SizedBox(height: EsokoSpacing.s2),
        Text(
          canVerify
              ? 'Pay for goods or verify a staff fare collection.'
              : 'Pay a shopper’s or traveller’s QR code. No cash needed.',
          textAlign: TextAlign.center,
          // Theme-derived, not the fixed EsokoColors.text3 — this sits
          // on the home tab's normal scaffold background (paper/dark),
          // unlike the navy hero card above it, which is always dark.
          style: TextStyle(
            color: Theme.of(context).textTheme.bodySmall?.color,
            fontSize: 12.5,
            height: 1.4,
          ),
        ),
      ],
    );
  }
}
