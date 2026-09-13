import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/active_role.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../bills/bills_list_screen.dart';
import '../fleet/fleet_providers.dart';
import '../fleet/transport_screen.dart';
import '../groups/my_groups_screen.dart';
import '../parcels/parcel_models.dart';
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
  /// A live, OTP-activated org-staff context (see core/auth/
  /// org_context_state.dart and docs/proposals/
  /// esoko-unified-crew-identity.md) is folded into the same "crew" tier
  /// at the call site — someone switched on for a shift is exactly as
  /// time-pressured as an AGENT crew session, regardless of which
  /// mechanism granted it.
  /// Parcels used to sit last in every order, with a note here saying it
  /// would stay there "until a 'parcels I'm holding' count is worth
  /// surfacing". That condition is now met: a courier mid-round has a
  /// custody count and, on a cash-on-delivery run, somebody else's money
  /// in their pocket. So [holdingParcels] joins the same top tier
  /// `crew` already occupies, for the identical reason — a person
  /// carrying something that has to reach a door today is the most
  /// time-pressured state this hub can detect, and burying it under
  /// five other services was costing them taps on every single job.
  ///
  /// Everyone else still sees Parcels last: for a person who sends one
  /// parcel a month it genuinely is the least urgent tile.
  static List<String> _order({
    required bool crew,
    required bool runsOrg,
    required bool inGroup,
    required bool holdingParcels,
  }) {
    if (holdingParcels) {
      return const [
        'Parcels',
        'Transport',
        'Bills',
        'Shopping',
        'Tickets',
        'Groups',
      ];
    }
    if (crew) {
      return const [
        'Transport',
        'Bills',
        'Shopping',
        'Tickets',
        'Groups',
        'Parcels',
      ];
    }
    if (runsOrg) {
      return const [
        'Transport',
        'Tickets',
        'Bills',
        'Shopping',
        'Groups',
        'Parcels',
      ];
    }
    if (inGroup) {
      return const [
        'Groups',
        'Bills',
        'Transport',
        'Shopping',
        'Tickets',
        'Parcels',
      ];
    }
    return const [
      'Transport',
      'Bills',
      'Shopping',
      'Tickets',
      'Groups',
      'Parcels',
    ];
  }

  /// The live figure worth stating on the lead card before any tap.
  /// Null for roles that have none — an empty chip is worse than no
  /// chip.
  static String? _leadDetail(ActiveRole role, Money codFloat) {
    return switch (role.role) {
      EsokoRole.courier => codFloat.isPositive
          ? '${role.heldParcels} in hand · KES ${codFloat.format()} to hand in'
          : '${role.heldParcels} in hand',
      _ => null,
    };
  }

  /// The one action this role most likely opened the app for.
  static String _leadPrimaryLabel(ActiveRole role) => switch (role.role) {
        EsokoRole.personal => 'Scan anything',
        EsokoRole.courier => 'Your parcels',
        EsokoRole.crew => 'Verify a fare',
        EsokoRole.scanner => 'Scan a ticket',
        EsokoRole.manager => 'Today’s takings',
      };

  static void _onLeadPrimary(BuildContext context, ActiveRole role) {
    switch (role.role) {
      case EsokoRole.personal:
      case EsokoRole.scanner:
      case EsokoRole.crew:
        // All three land on the scanner: it is the dispatcher that
        // already routes a bus QR, a ticket, a shelf tag or a receipt to
        // the right screen (see UniversalScanScreen), so the role only
        // needs to change the words, not the destination.
        showScanSheet(context);
      case EsokoRole.courier:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const ParcelsHubScreen()),
        );
      case EsokoRole.manager:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const TransportScreen()),
        );
    }
  }

  /// What a courier mid-round needs off the hub without tapping in.
  static String _parcelSubtitle(int heldCount, Money codFloat) {
    final parcels = '$heldCount ${heldCount == 1 ? 'parcel' : 'parcels'} in your hands';
    if (!codFloat.isPositive) return '$parcels.';
    return '$parcels · KES ${codFloat.format()} to hand in.';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    final name = profile?.displayName;
    final canVerify = canVerifyFare(profile);
    final onOrgDuty = ref.watch(orgContextControllerProvider).active != null;

    // Best-effort, non-blocking: the hub renders the default order
    // immediately and only re-sorts once these resolve, rather than
    // holding the whole screen behind two extra network round-trips.
    final runsOrg = auth is AuthSignedIn
        ? (ref.watch(myOrgsProvider).valueOrNull?.isNotEmpty ?? false)
        : false;
    final inGroup = auth is AuthSignedIn
        ? (ref.watch(myGroupsProvider).valueOrNull?.isNotEmpty ?? false)
        : false;
    // Same best-effort, non-blocking treatment the two signals above
    // get: the hub renders immediately and re-sorts if this resolves.
    final held = auth is AuthSignedIn
        ? (ref.watch(heldParcelsProvider).valueOrNull ?? const <ParcelRow>[])
        : const <ParcelRow>[];
    final codFloat = auth is AuthSignedIn
        ? (ref.watch(codHoldingProvider).valueOrNull?.amountKes ?? Money.zero)
        : Money.zero;

    // The role the app should lead with, from signals this screen
    // already has. Held parcels outrank an org grant — see
    // resolveActiveRole for why custody wins.
    final role = resolveActiveRole(
      auth: auth,
      orgContext: ref.watch(orgContextControllerProvider),
      heldParcels: held.length,
      holdingCash: codFloat.isPositive,
    );

    final order = _order(
      crew: canVerify || onOrgDuty,
      runsOrg: runsOrg,
      inGroup: inGroup,
      holdingParcels: held.isNotEmpty,
    );

    return ListView(
      // The bottom inset clears the scan FAB, not just the bar.
      // Scaffold already keeps the body above `bottomNavigationBar`,
      // but a centre-docked FAB overhangs that bar by half its height
      // and sits *on* the body — so the last tile scrolls underneath it
      // and its subtitle becomes unreadable at the one moment somebody
      // is trying to read it. s9 is the FAB's overhang plus the same
      // s6 breathing room every other edge gets.
      padding: const EdgeInsets.fromLTRB(
        EsokoSpacing.s6,
        EsokoSpacing.s4,
        EsokoSpacing.s6,
        EsokoSpacing.s9 + EsokoSpacing.s6,
      ),
      children: [
        // One card that changes with who you are, instead of the same
        // greeting plus the same scan prompt for everybody.
        EsokoRoleLead(
          role: role,
          displayName: name ?? 'Welcome back',
          esokoId: profile?.esokoId,
          detail: _leadDetail(role, codFloat),
          primaryLabel: _leadPrimaryLabel(role),
          onPrimary: () => _onLeadPrimary(context, role),
          secondaryLabel: role.role == EsokoRole.courier ? 'Scan' : null,
          onSecondary: role.role == EsokoRole.courier
              ? () => showScanSheet(context)
              : null,
        ),
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
                // Parcels is the one tile whose subtitle is worth
                // replacing with live state: "3 in your hands" answers
                // the question a courier opened the app to ask, and the
                // cash line is somebody else's money they're carrying.
                subtitle: title == 'Parcels' && held.isNotEmpty
                    ? _parcelSubtitle(held.length, codFloat)
                    : service.subtitle,
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
