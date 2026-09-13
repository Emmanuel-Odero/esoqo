import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/active_role.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../scan/scan_sheet.dart';
import 'home_hub_screen.dart';
import 'org_duty_switcher_screen.dart';
import 'profile_screen.dart';

/// The app's frame: two real destinations, and Scan as the action it
/// actually is.
///
/// ## Scan was a tab that was not a destination
///
/// The bottom bar used to carry Home · Scan · Settings, where tapping
/// Scan opened a modal sheet and left the selection where it was. That
/// is a broken contract — a tab is a *place*, and a tab that opens a
/// sheet teaches people their taps do not mean what they look like. The
/// code apologised for it in two expressions, `_index > 1 ? 1 : 0` and
/// `selectedIndex: _index == 2 ? 2 : 0`, which existed only to keep a
/// non-destination out of the destination index.
///
/// Scan is now a centre floating action button: still one tap from
/// anywhere, still the app's signature action, but no longer pretending
/// to be somewhere you can be. The two remaining destinations index
/// straight into [_screens] with no arithmetic.
///
/// ## The chrome says who you are
///
/// The app bar takes its colour from [ActiveRole], so switching into an
/// org is visible in the frame and not only inside one card — navy for
/// your own account, blue for an institution you are acting for, amber
/// while you are carrying somebody's parcels.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _screens = [HomeHubScreen(), ProfileScreen()];

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(activeRoleProvider);
    final onHome = _index == 0;

    // Only the Home tab wears the role's colour. Settings is about the
    // account itself rather than the hat being worn, so tinting it blue
    // would say something untrue.
    final Color? barColour = !onHome
        ? null
        : switch (role.role) {
            EsokoRole.personal => null,
            EsokoRole.courier => EsokoColors.amber,
            _ => EsokoColors.blue,
          };

    return Scaffold(
      appBar: EsokoAppBar(
        title: onHome ? 'Home' : 'Settings',
        backgroundColor: barColour,
        titleWidget: onHome
            ? (role.isPersonal
                // Default size (30) reads too small against this app
                // bar's own 19px title style elsewhere — this is the
                // one place the brand mark itself is the "title".
                ? const EsokoBrandLockup(size: 40)
                : Text(
                    role.title,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ))
            : null,
        actions: onHome
            ? const [HatsIconButton(), SizedBox(width: EsokoSpacing.s2)]
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
        // sits in; the two destinations live either side of it.
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
            // The gap the FAB occupies.
            const SizedBox(width: 56),
            _NavItem(
              icon: Icons.settings_outlined,
              activeIcon: Icons.settings_rounded,
              label: 'Settings',
              selected: _index == 1,
              onTap: () => setState(() => _index = 1),
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
          borderRadius: BorderRadius.circular(EsokoRadius.md),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            alignment: Alignment.center,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(selected ? activeIcon : icon, size: 22, color: colour),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
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
