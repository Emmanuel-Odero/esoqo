import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../scan/universal_scan_screen.dart';
import 'fare_pay_screen.dart';
import 'fleet_providers.dart';
import 'org_fleet_screen.dart';
import 'verify_fare_screen.dart';
import '../vouchers/voucher_wallet_screen.dart';

/// Transport home — public fare payment on top; the companies the
/// signed-in subject runs below (rendered only when their capabilities
/// include a fleet grant — owners hold `fleet.read:own`). Every
/// manager action inside is enforced server-side by
/// dbx.AssertOwnsOrg; this gating is navigation convenience only.
class TransportScreen extends ConsumerWidget {
  const TransportScreen({super.key});

  static bool canManage(EsokoProfile? profile) {
    if (profile == null) return false;
    return profile.has('fleet.read') ||
        profile.has('fleet.read:own') ||
        profile.has('trip.read') ||
        profile.has('trip.read:own');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    // Crew-only entries never render for passengers — the server
    // enforces the same rule, this just keeps the screen clean.
    final crew = canVerifyFare(profile);

    // Bar-less Scaffold: the Home hub wraps this screen in its own
    // Scaffold + EsokoAppBar (like ListingListScreen/MyGroupsScreen) —
    // an appBar here would stack a second header under the hub's.
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: ListView(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              children: [
                const EsokoPageLead('Pay bus fare, or run your fleet.'),
                const SizedBox(height: EsokoSpacing.s4),
                EsokoStagger(
                  index: 0,
                  child: EsokoListTile(
                    title: 'Scan to board',
                    subtitle: 'Scan the Esoko code inside the matatu to pay.',
                    leading: const EsokoQuickActionIcon(icon: Icons.qr_code_scanner_outlined),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const UniversalScanScreen()),
                    ),
                  ),
                ),
                EsokoStagger(
                  index: 1,
                  child: EsokoListTile(
                    title: 'Pay bus fare',
                    subtitle: 'Pick a bus on the road and pay by M-Pesa or voucher.',
                    leading: const EsokoQuickActionIcon(icon: Icons.payments_outlined),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const FarePayScreen()),
                    ),
                  ),
                ),
                if (crew)
                  EsokoStagger(
                    index: 2,
                    child: EsokoListTile(
                      title: 'Verify fare (crew)',
                      subtitle: 'Scan passenger receipt or M-Pesa code.',
                      leading: const EsokoQuickActionIcon(icon: Icons.verified_outlined),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const VerifyFareScreen()),
                      ),
                    ),
                  ),
                EsokoStagger(
                  index: 3,
                  child: EsokoListTile(
                    title: 'Vouchers',
                    subtitle: 'Fare, rent, shopping cards + loyalty.',
                    leading: const EsokoQuickActionIcon(icon: Icons.wallet_outlined),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const VoucherWalletScreen()),
                    ),
                  ),
                ),
                if (canManage(profile)) ...[
                  const SizedBox(height: EsokoSpacing.s5),
                  EsokoSectionHeader(
                    title: 'My companies',
                    subtitle: 'Fleets you run.',
                  ),
                  const SizedBox(height: EsokoSpacing.s2),
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
    return EsokoAsyncView(
      value: orgs,
      isEmpty: (list) => list.isEmpty,
      emptyMessage: 'No transport companies on your account yet.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(myOrgsProvider),
      data: (context, list) => Column(
        children: [
          for (var i = 0; i < list.length; i++)
            EsokoStagger(
              index: 4 + i,
              child: EsokoListTile(
                title: list[i].name,
                subtitle: list[i].status,
                leading: const EsokoQuickActionIcon(icon: Icons.directions_bus_outlined),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => OrgFleetScreen(orgId: list[i].id, orgName: list[i].name),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
