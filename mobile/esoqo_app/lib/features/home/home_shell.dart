import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/active_role.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../account/account_screen.dart';
import '../activity/activity_screen.dart';
import '../money/money_screen.dart';
import '../scan/scan_sheet.dart';
import 'home_hub_screen.dart';
import 'org_duty_switcher_screen.dart';

/// The app's frame: four destinations, and Scan as the action it
/// actually is.
///
/// ## Four, not two
///
/// This used to be `static const _screens = [HomeHubScreen(),
/// ProfileScreen()]` — Home and a Settings screen holding everything
/// that didn't fit Home, points and order history included. Neither
/// was reachable except by scrolling to the bottom of one long list,
/// which is another way of saying neither had a destination at all.
/// Wallet and Activity are the two questions that kept getting asked of
/// this app with no screen that answered them — "what's mine" and
/// "what happened" — so they're real tabs now, not sections.
///
/// ## Scan was a tab that was not a destination
///
/// The bottom bar used to carry Home · Scan · Settings, where tapping
/// Scan opened a modal sheet and left the selection where it was. That
/// is a broken contract — a tab is a *place*, and a tab that opens a
/// sheet teaches people their taps do not mean what they look like.
/// Scan is a centre floating action button instead: still one tap from
/// anywhere, still the app's signature action, but never pretending to
/// be somewhere you can be. The four real destinations index straight
/// into [_screens] with no arithmetic.
///
/// ## The chrome says who you are
///
/// The app bar takes its colour from [ActiveRole], so switching into an
/// org is visible in the frame and not only inside one card — navy for
/// your own account, blue for an institution you are acting for, amber
/// while you are carrying somebody's parcels. Only the Home tab wears
/// it: Wallet, Activity and Account are about the person, not the hat
/// they're wearing, so tinting them would say something untrue.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _screens = [
    HomeHubScreen(),
    MoneyScreen(),
    ActivityScreen(),
    AccountScreen(),
  ];

  static const _titles = ['Home', 'Wallet', 'Activity', 'Account'];

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(activeRoleProvider);
    final onHome = _index == 0;

    final Color? barColour = !onHome
        ? null
        : switch (role.role) {
            EsoqoRole.personal => null,
            EsoqoRole.courier => EsoqoColors.amber,
            _ => EsoqoColors.blue,
          };

    return Scaffold(
      appBar: EsoqoAppBar(
        title: _titles[_index],
        backgroundColor: barColour,
        titleWidget: onHome
            ? (role.isPersonal
                // Default size (30) reads too small against this app
                // bar's own 19px title style elsewhere — this is the
                // one place the brand mark itself is the "title".
                ? const EsoqoBrandLockup(size: 40)
                : Text(
                    role.title,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: EsoqoTypeScale.subTitle,
                    ),
                  ))
            : null,
        actions: onHome
            ? const [HatsIconButton(), SizedBox(width: EsoqoSpacing.s2)]
            : null,
      ),
      body: SafeArea(
        child: IndexedStack(index: _index, children: _screens),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => showScanSheet(context),
        tooltip: 'Scan',
        child: const Icon(Icons.qr_code_scanner_rounded),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: BottomAppBar(
        // notchMargin + the docked FAB above cut the notch the scanner
        // sits in; two destinations sit either side of it.
        shape: const CircularNotchedRectangle(),
        notchMargin: 6,
        height: 64,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _NavItem(
              icon: Icons.home_outlined,
              activeIcon: Icons.home_rounded,
              label: 'Home',
              selected: _index == 0,
              onTap: () => setState(() => _index = 0),
            ),
            _NavItem(
              icon: Icons.account_balance_wallet_outlined,
              activeIcon: Icons.account_balance_wallet_rounded,
              label: 'Wallet',
              selected: _index == 1,
              onTap: () => setState(() => _index = 1),
            ),
            // The gap the FAB occupies.
            const SizedBox(width: 56),
            _NavItem(
              icon: Icons.history_outlined,
              activeIcon: Icons.history_rounded,
              label: 'Activity',
              selected: _index == 2,
              onTap: () => setState(() => _index = 2),
            ),
            _NavItem(
              icon: Icons.person_outline,
              activeIcon: Icons.person_rounded,
              label: 'Account',
              selected: _index == 3,
              onTap: () => setState(() => _index = 3),
            ),
          ],
        ),
      ),
    );
  }
}

/// One bottom-bar destination.
///
/// Hand-rolled rather than [NavigationBar] because that widget owns its
/// own layout and cannot leave a notch for a docked FAB. Keeps the
/// pieces that matter: a 48px target, a selected state carried by both
/// colour and icon weight rather than colour alone, and a single
/// `selected` semantic so a screen reader announces the tab state.
class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = selected ? scheme.primary : scheme.onSurfaceVariant;

    return Expanded(
      child: Semantics(
        selected: selected,
        button: true,
        label: label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EsoqoRadius.md),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            alignment: Alignment.center,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(selected ? activeIcon : icon, size: 22, color: colour),
                const SizedBox(height: 2),
                // The label voice, not a bare TextStyle. A bare one
                // merges with the ambient DefaultTextStyle and so
                // inherits *body* line-height (1.5) — which at 12pt is
                // 18pt tall and overflowed this 40pt-capped Column by
                // exactly 2px. Destination labels are furniture: the
                // label style's 1.2 is both correct typographically and
                // the reason this fits.
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelMedium!.copyWith(
                    fontWeight: selected
                        ? FontWeight.w700
                        : EsoqoTypography.labelWeight,
                    color: colour,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
