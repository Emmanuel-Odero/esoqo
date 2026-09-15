import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../scan/universal_scan_screen.dart';
import 'fare_pay_screen.dart';
import 'fleet_providers.dart';
import 'org_fleet_screen.dart';
import 'verify_fare_screen.dart';

/// Transport home — public fare payment on top; the companies the
/// signed-in subject actually runs below, rendered only when
/// `myOrgsProvider` actually has entries. Every manager action inside
/// is enforced server-side by dbx.AssertOwnsOrg; this gating is
/// navigation convenience only.
class TransportScreen extends ConsumerWidget {
  const TransportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    // Crew-only entries never render for passengers — the server
    // enforces the same rule, this just keeps the screen clean.
    final crew = canVerifyFare(profile);
    // NOT `profile.has('fleet.read:own')` — every signed-in SUBJECT
    // holds that blanket `:own` grant unconditionally (see
    // authsvc.RolePresets), so it can't tell "runs a company" from
    // "plain personal account"; the whole point of the profile
    // switcher was to keep this section out of the way for the second
    // group. Whether `myOrgsProvider` actually came back non-empty is
    // the real signal — same one home_hub_screen's own reorder logic
    // uses for the same reason (see its "runsOrg" comment).
    final runsOrg = ref.watch(myOrgsProvider).valueOrNull?.isNotEmpty ?? false;

    // Bar-less Scaffold: the Home hub wraps this screen in its own
    // Scaffold + EsoqoAppBar (like ListingListScreen/MyGroupsScreen) —
    // an appBar here would stack a second header under the hub's.
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsoqoSpacing.s4),
              children: [
                const EsoqoPageLead('Pay bus fare, or run your fleet.'),
                const SizedBox(height: EsoqoSpacing.s4),
                // The proposal's scan-to-board hero: of the three things
                // this screen can do, this is the one that happens
                // standing inside a moving matatu with one hand free,
                // so it gets the card everything else in the app leads
                // with rather than a row identical to "Verify fare".
                EsoqoStagger(
                  index: 0,
                  child: _ScanToBoardHero(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const UniversalScanScreen(),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: EsoqoSpacing.s4),
                EsoqoStagger(
                  index: 1,
                  child: EsoqoListTile(
                    title: 'Pay bus fare',
                    subtitle:
                        'Pick a bus on the road and pay by M-Pesa or voucher.',
                    leading: const EsoqoQuickActionIcon(
                      icon: Icons.payments_outlined,
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const FarePayScreen()),
                    ),
                  ),
                ),
                if (crew)
                  EsoqoStagger(
                    index: 2,
                    child: EsoqoListTile(
                      title: 'Verify fare (crew)',
                      subtitle: 'Scan passenger receipt or M-Pesa code.',
                      leading: const EsoqoQuickActionIcon(
                        icon: Icons.verified_outlined,
                      ),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const VerifyFareScreen(),
                        ),
                      ),
                    ),
                  ),
                // Vouchers moved to the Wallet tab — a fare card is
                // money, not a bus, and it belongs with the other
                // things that are yours rather than filed under
                // whichever service happened to spend it first.
                if (runsOrg) ...[
                  const SizedBox(height: EsoqoSpacing.s5),
                  EsoqoSectionHeader(
                    title: 'Your companies',
                    subtitle: 'Fleets you run.',
                  ),
                  const SizedBox(height: EsoqoSpacing.s2),
                  _orgs(ref),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _orgs(WidgetRef ref) {
    final orgs = ref.watch(myOrgsProvider);
    return EsoqoAsyncView(
      value: orgs,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No transport companies on your account yet.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(myOrgsProvider),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsoqoStagger(
              index: 3 + i,
              child: EsoqoListTile(
                title: list[i].name,
                subtitle: list[i].status,
                leading: const EsoqoQuickActionIcon(
                  icon: Icons.directions_bus_outlined,
                ),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrgFleetScreen(
                      orgId: list[i].id,
                      orgName: list[i].name,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The full-card, one-tap version of "Scan to board" — navy, per
/// SCREEN_CONVENTIONS.md Rule 3 (this is the person's own action, not
/// an institution's), matching the wallet/identity heroes Wallet and
/// Account already lead with. The whole card is tappable, not just the
/// button beneath the icon, since a thumb reaching for a bus door
/// shouldn't need to land on a precise target.
class _ScanToBoardHero extends StatelessWidget {
  const _ScanToBoardHero({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return EsoqoCard(
      color: EsoqoColors.navy,
      padding: const EdgeInsets.all(EsoqoSpacing.s5),
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(EsoqoRadius.lg),
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.qr_code_scanner_rounded,
              color: Colors.white,
              size: 28,
            ),
          ),
          const SizedBox(width: EsoqoSpacing.s4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Scan to board',
                  style: TextStyle(
                    color: Colors.white,
                    fontFamily: EsoqoFonts.display,
                    fontSize: EsoqoTypeScale.cardTitle,
                    fontWeight: FontWeight.w700,
                    height: EsoqoTypography.headlineHeight,
                    letterSpacing:
                        EsoqoTypeScale.cardTitle *
                        EsoqoTypography.headlineTrackingEm,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Scan the Esoqo code inside the matatu to pay.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: EsoqoTypeScale.meta,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right_rounded,
            color: Colors.white.withValues(alpha: 0.7),
          ),
        ],
      ),
    );
  }
}
