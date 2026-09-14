import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/fleet_providers.dart';
import 'account_businesses_screen.dart';
import 'account_details_screen.dart';
import 'account_security_screen.dart';

/// The Account destination: a short list of doors, not a long scroll.
///
/// This screen was 512 lines of stacked cards — identity, a 200px QR
/// code, a PIN form, companies — with the one thing most people came
/// for (a name, a PIN) sandwiched in the middle and Sign out below the
/// fold. Each card is now a screen of its own behind a labelled row,
/// which is what the reorganisation proposal asked for.
///
/// ## Four doors, not the proposal's six
///
/// The proposal sketched six, including "Payment methods" and
/// "Notifications". Neither is built: core-go has no endpoint behind
/// either (`/v1/me/*` has no payment-method or notification-preference
/// route — see server.go), so both would be rows that open an empty
/// screen. A door to nowhere is worse than no door, so they wait for
/// the server work rather than shipping as stubs.
///
/// "Your businesses" only appears when there is something behind it,
/// matching what the old inline section already did for a plain
/// subject.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      return const Padding(
        padding: EdgeInsets.all(EsokoSpacing.s5),
        child: EsokoSkeletonList(count: 4),
      );
    }
    final profile = auth.profile;

    final hasBusinesses =
        (ref.watch(myOrgsProvider).valueOrNull?.isNotEmpty ?? false) ||
            ref.watch(orgContextControllerProvider).grants.isNotEmpty;

    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(orgContextControllerProvider.notifier).refreshGrants();
        ref.invalidate(myOrgsProvider);
      },
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              EsokoSpacing.s6,
              EsokoSpacing.s4,
              EsokoSpacing.s6,
              EsokoSpacing.s9 + EsokoSpacing.s6,
            ),
            children: [
              // Who you are, stated once at the top rather than made a
              // door of its own — a person opening Account should see
              // whose account it is without a tap.
              EsokoCard(
                color: EsokoColors.navy,
                padding: const EdgeInsets.all(EsokoSpacing.s5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      profile.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontFamily: EsokoFonts.display,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (profile.msisdn != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        profile.msisdn!,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.72),
                          fontSize: 13,
                        ),
                      ),
                    ],
                    if (profile.esokoId != null) ...[
                      const SizedBox(height: EsokoSpacing.s2),
                      Text(
                        profile.esokoId!,
                        style: EsokoTypography.mono(
                          fontSize: 12.5,
                          color: Colors.white.withValues(alpha: 0.72),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: EsokoSpacing.s5),

              _door(
                context,
                icon: Icons.badge_outlined,
                title: 'Your details',
                subtitle: 'Name, phone, payment QR',
                screen: const AccountDetailsScreen(),
              ),
              _door(
                context,
                icon: Icons.lock_outline,
                title: 'Security',
                subtitle: 'The PIN you sign in with',
                screen: const AccountSecurityScreen(),
              ),
              if (hasBusinesses)
                _door(
                  context,
                  icon: Icons.storefront_outlined,
                  title: 'Your businesses',
                  subtitle: 'Companies you own, and duty you can switch on',
                  screen: const AccountBusinessesScreen(),
                  institutional: true,
                ),

              const SizedBox(height: EsokoSpacing.s5),
              EsokoButton.secondary(
                label: 'Sign out',
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _door(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget screen,
    bool institutional = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: title,
        subtitle: subtitle,
        icon: icon,
        // Blue for a door into something an organisation owns, per
        // SCREEN_CONVENTIONS.md Rule 3 — the same distinction the
        // tiles behind it already draw.
        iconColor: institutional ? EsokoColors.blue : null,
        iconBackground: institutional ? EsokoColors.blueTint : null,
        trailing: const Icon(Icons.chevron_right, size: 20),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => screen),
        ),
      ),
    );
  }
}
