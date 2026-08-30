import 'package:flutter/material.dart';

import 'coming_soon_screen.dart';
import 'record_screen.dart';

/// Bottom-nav shell — Record is real (GET /v1/me); Groups/Shopping/
/// Tickets are honest placeholders until core-go's Phase 1 domain
/// endpoints exist (see docs/adr/0005-mobile-api-in-go.md).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _tabs = [
    (icon: Icons.badge_outlined, label: 'Record'),
    (icon: Icons.groups_outlined, label: 'Groups'),
    (icon: Icons.storefront_outlined, label: 'Shopping'),
    (icon: Icons.confirmation_num_outlined, label: 'Tickets'),
  ];

  Widget _body(int index) {
    switch (index) {
      case 0:
        return const RecordScreen();
      case 1:
        return const ComingSoonScreen(
          title: 'Groups',
          icon: Icons.groups_outlined,
          description: 'Chama membership, contributions and withdrawals are coming to '
              'the app once core-go\'s groups/treasury API ships.',
        );
      case 2:
        return const ComingSoonScreen(
          title: 'Shopping',
          icon: Icons.storefront_outlined,
          description: 'Browsing stores and checking out is coming to the app once '
              'core-go\'s store API ships.',
        );
      case 3:
        return const ComingSoonScreen(
          title: 'Tickets',
          icon: Icons.confirmation_num_outlined,
          description: 'Booking and holding tickets is coming to the app once '
              'core-go\'s ticketing API ships.',
        );
      default:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_tabs[_index].label)),
      body: SafeArea(child: _body(_index)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final tab in _tabs) NavigationDestination(icon: Icon(tab.icon), label: tab.label),
        ],
      ),
    );
  }
}
