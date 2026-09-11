import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../scan/scan_sheet.dart';
import 'home_hub_screen.dart';
import 'org_duty_switcher_screen.dart';
import 'profile_screen.dart';

/// Bottom nav — Home, Scan, Settings. Scan is an action, not a screen:
/// tapping it opens the scan sheet (bus QR / fare verify) without
/// leaving the current tab, so the scanner is one tap away from anywhere.
///
/// An IndexedStack keeps both tabs mounted so switching never refetches or
/// loses scroll position (each tab's FutureProvider.autoDispose watchers
/// stay alive across a switch).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _tabs = [
    (icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
    (
      icon: Icons.qr_code_scanner_outlined,
      activeIcon: Icons.qr_code_scanner_rounded,
      label: 'Scan',
    ),
    (
      icon: Icons.settings_outlined,
      activeIcon: Icons.settings_rounded,
      label: 'Settings',
    ),
  ];

  static const _screens = [HomeHubScreen(), ProfileScreen()];

  int _screenIndex() => _index > 1 ? 1 : _index;

  String _title() => _index == 2 ? 'Settings' : 'Home';

  void _onTap(int i) {
    if (i == 1) {
      showScanSheet(context);
      return;
    }
    setState(() => _index = i);
  }

  @override
  Widget build(BuildContext context) {
    // Which identity is active changes the bar itself, not just a small
    // icon inside it — blue (institution) + the org's own name/role
    // while switched on, the ordinary navy brand mark otherwise. Only
    // applies on the Home tab; Settings keeps its plain "Settings" bar
    // regardless, since account switching lives on Home.
    final active = ref.watch(orgContextControllerProvider).active;
    final onDuty = _index == 0 && active != null;

    return Scaffold(
      appBar: EsokoAppBar(
        title: _title(),
        backgroundColor: onDuty ? EsokoColors.blue : null,
        titleWidget: _index == 0
            ? (onDuty
                ? Text(
                    '${active.orgName} · ${active.role}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                  )
                // Default size (30) reads too small against this app
                // bar's own 19px title style elsewhere — this is the
                // one place the brand mark itself is the "title", so
                // it gets more room than other call sites keep for a
                // leading/inline lockup.
                : const EsokoBrandLockup(size: 40))
            : null,
        actions: _index == 0 ? const [HatsIconButton(), SizedBox(width: EsokoSpacing.s2)] : null,
      ),
      body: SafeArea(
        child: IndexedStack(index: _screenIndex(), children: _screens),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index == 2 ? 2 : 0,
        onDestinationSelected: _onTap,
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(
              icon: Icon(tab.icon),
              selectedIcon: Icon(tab.activeIcon),
              label: tab.label,
            ),
        ],
      ),
    );
  }
}
