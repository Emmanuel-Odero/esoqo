import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/active_role.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/money/money.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../bills/bill_models.dart';
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
/// Chama, Bills and Parcels all live here instead of competing for
/// bottom-nav slots. Each tile pushes its existing list screen inside
/// an [EsoqoServiceScaffold] so the destination keeps a proper title
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
    // Named for what it actually is, not the generic container it used
    // to be filed under — "Groups" could be any messaging app's
    // feature; "Chama" is the word every user already reaches for, and
    // it's the one name here no competitor can credibly borrow.
    'Chama': (
      title: 'Chama',
      subtitle: 'Table banking, welfare and savings groups.',
      icon: Icons.groups_outlined,
      appBar: 'Chama',
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
  /// esoqo-unified-crew-identity.md) is folded into the same "crew" tier
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
        'Chama',
      ];
    }
    if (crew) {
      return const [
        'Transport',
        'Bills',
        'Shopping',
        'Tickets',
        'Chama',
        'Parcels',
      ];
    }
    if (runsOrg) {
      return const [
        'Transport',
        'Tickets',
        'Bills',
        'Shopping',
        'Chama',
        'Parcels',
      ];
    }
    if (inGroup) {
      return const [
        'Chama',
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
      'Chama',
      'Parcels',
    ];
  }

  /// The live figure worth stating on the lead card before any tap.
  /// Null for roles that have none — an empty chip is worse than no
  /// chip.
  static String? _leadDetail(ActiveRole role, Money codFloat) {
    return switch (role.role) {
      EsoqoRole.courier => codFloat.isPositive
          ? '${role.heldParcels} in hand · KES ${codFloat.format()} to hand in'
          : '${role.heldParcels} in hand',
      _ => null,
    };
  }

  /// The one action this role most likely opened the app for.
  static String _leadPrimaryLabel(ActiveRole role) => switch (role.role) {
        EsoqoRole.personal => 'Scan anything',
        EsoqoRole.courier => 'Your parcels',
        EsoqoRole.crew => 'Verify a fare',
        EsoqoRole.scanner => 'Scan a ticket',
        EsoqoRole.manager => 'Today’s takings',
      };

  static void _onLeadPrimary(BuildContext context, ActiveRole role) {
    switch (role.role) {
      case EsoqoRole.personal:
      case EsoqoRole.scanner:
      case EsoqoRole.crew:
        // All three land on the scanner: it is the dispatcher that
        // already routes a bus QR, a ticket, a shelf tag or a receipt to
        // the right screen (see UniversalScanScreen), so the role only
        // needs to change the words, not the destination.
        showScanSheet(context);
      case EsoqoRole.courier:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const ParcelsHubScreen()),
        );
      case EsoqoRole.manager:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const TransportScreen()),
        );
    }
  }

  /// Statuses that mean a parcel is moving and hasn't arrived — the set
  /// worth surfacing on the hub before anybody taps into Parcels.
  /// DRAFT_PENDING_PAYMENT is deliberately out: an unpaid draft isn't
  /// on its way anywhere, and putting it under "Needs you today" would
  /// be nagging about something the sender already abandoned.
  static const _inFlight = {'BOOKED', 'PICKED_UP', 'IN_TRANSIT'};

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

    final attention = _attention(ref, signedIn: auth is AuthSignedIn);

    return ListView(
      // The bottom inset clears the scan FAB, not just the bar.
      // Scaffold already keeps the body above `bottomNavigationBar`,
      // but a centre-docked FAB overhangs that bar by half its height
      // and sits *on* the body — so the last row scrolls underneath it
      // at the one moment somebody is trying to read it. s9 is the
      // FAB's overhang plus the same s6 breathing room every other
      // edge gets.
      padding: const EdgeInsets.fromLTRB(
        EsoqoSpacing.s6,
        EsoqoSpacing.s4,
        EsoqoSpacing.s6,
        EsoqoSpacing.s9 + EsoqoSpacing.s6,
      ),
      children: [
        // One card that changes with who you are, instead of the same
        // greeting plus the same scan prompt for everybody.
        EsoqoRoleLead(
          role: role,
          displayName: name ?? 'Welcome back',
          esoqoId: profile?.esoqoId,
          detail: _leadDetail(role, codFloat),
          primaryLabel: _leadPrimaryLabel(role),
          onPrimary: () => _onLeadPrimary(context, role),
          secondaryLabel: role.role == EsoqoRole.courier ? 'Scan' : null,
          onSecondary: role.role == EsoqoRole.courier
              ? () => showScanSheet(context)
              : null,
        ),

        // Anything with a deadline on it, before the launcher. This is
        // the half of the hub that changes day to day — a bill about to
        // fall due, a parcel still moving — and it renders nothing at
        // all when there's nothing pressing, rather than an empty
        // "Nothing to do" card that everyone learns to scroll past.
        if (attention.isNotEmpty) ...[
          const SizedBox(height: EsoqoSpacing.s5),
          const EsoqoSubHeader('Needs you today'),
          const SizedBox(height: EsoqoSpacing.s3),
          for (var i = 0; i < attention.length; i++) ...[
            EsoqoStagger(index: i, child: attention[i]),
            const SizedBox(height: EsoqoSpacing.s3),
          ],
        ],

        const SizedBox(height: EsoqoSpacing.s4),
        const EsoqoSubHeader('Services'),
        const SizedBox(height: EsoqoSpacing.s3),
        GridView(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          // mainAxisExtent, not childAspectRatio: the tile's content is
          // a fixed 40px icon plus one line of label, so the height it
          // needs is a constant. An aspect ratio makes that height a
          // function of the *width* instead, which on a narrower phone
          // silently shrinks the cell until the icon no longer fits —
          // exactly how this overflowed by 16px the first time. The
          // label is Flexible inside the tile, so a large text scale
          // ellipsises rather than bursting this budget.
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4,
            mainAxisSpacing: EsoqoSpacing.s3,
            crossAxisSpacing: EsoqoSpacing.s3,
            mainAxisExtent: 96,
          ),
          children: [
            for (var i = 0; i < order.length; i++)
              if (_services[order[i]] case final service?)
                EsoqoStagger(
                  index: i,
                  child: EsoqoServiceTile(
                    label: service.title,
                    icon: service.icon,
                    heroTag: 'esoqo-service-${service.title}',
                    // Parcels is the one tile with live state worth
                    // seeing before the tap: a courier mid-round wants
                    // the custody count, and the grid has no subtitle
                    // left to put it in.
                    badge: order[i] == 'Parcels' && held.isNotEmpty
                        ? '${held.length}'
                        : null,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => EsoqoServiceScaffold(
                          title: service.appBar,
                          icon: service.icon,
                          heroTag: 'esoqo-service-${service.title}',
                          child: service.screen,
                        ),
                      ),
                    ),
                  ),
                ),
          ],
        ),
      ],
    );
  }

  /// The deadline cards for "Needs you today", most urgent first.
  ///
  /// Every signal here comes from a provider some other screen already
  /// watches — no new endpoint, per the proposal. All of them are read
  /// best-effort through `valueOrNull`: the hub renders immediately and
  /// grows these cards as each resolves, rather than holding the whole
  /// screen behind three more round trips.
  ///
  /// Capped at three. This is a summary, not an inbox — a hub that can
  /// scroll is a hub nobody reads the bottom of.
  List<Widget> _attention(WidgetRef ref, {required bool signedIn}) {
    if (!signedIn) return const [];
    final out = <Widget>[];

    final bills = ref.watch(myBillsProvider).valueOrNull ?? const <BillRow>[];
    final due = bills.where((b) => b.overdue || b.dueSoon).toList()
      ..sort((a, b) => a.daysUntilDue.compareTo(b.daysUntilDue));
    for (final b in due) {
      out.add(
        EsoqoAttentionCard(
          when: b.overdue
              ? '${-b.daysUntilDue} ${-b.daysUntilDue == 1 ? 'day' : 'days'} overdue'
              : b.daysUntilDue == 0
                  ? 'Due today'
                  : 'Due in ${b.daysUntilDue} ${b.daysUntilDue == 1 ? 'day' : 'days'}',
          title: b.label,
          amountKes: b.amountKes,
          accent: b.overdue ? EsoqoColors.red : EsoqoColors.amber,
          progress: b.isFunding ? b.fundingProgress : null,
          onTap: () => _openService(ref, 'Bills'),
        ),
      );
    }

    final sent = ref.watch(myParcelsProvider).valueOrNull ?? const <ParcelRow>[];
    for (final p in sent.where((p) => _inFlight.contains(p.status))) {
      out.add(
        EsoqoAttentionCard(
          when: parcelStatusLabel(p.status),
          title: p.code,
          detail: '${p.originLabel} → ${p.destinationLabel}',
          accent: EsoqoColors.green,
          onTap: () => _openService(ref, 'Parcels'),
        ),
      );
    }

    return out.take(3).toList();
  }

  /// Pushes a service by its key in [_services] — the same
  /// [EsoqoServiceScaffold] wrap a grid tap does, so an attention card
  /// and its tile land in the identical place.
  static void _openService(WidgetRef ref, String key) {
    final service = _services[key];
    if (service == null) return;
    final context = ref.context;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => EsoqoServiceScaffold(
          title: service.appBar,
          icon: service.icon,
          heroTag: 'esoqo-service-${service.title}',
          child: service.screen,
        ),
      ),
    );
  }
}
