import 'package:flutter/material.dart';

import '../../core/widgets/widgets.dart';
import '../scan/scan_sheet.dart';
import 'home_hub_screen.dart';
import 'profile_screen.dart';

/// Bottom nav — Home, Scan, Settings. Scan is an action, not a screen:
/// tapping it opens the scan sheet (bus QR / fare verify) without
/// leaving the current tab, so the scanner is one tap away from anywhere.
///
/// An IndexedStack keeps both tabs mounted so switching never refetches or
/// loses scroll position (each tab's FutureProvider.autoDispose watchers
/// stay alive across a switch).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
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
    return Scaffold(
      appBar: EsokoAppBar(
        title: _title(),
        titleWidget: _index == 0 ? const EsokoBrandLockup() : null,
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
