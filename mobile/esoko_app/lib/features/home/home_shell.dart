import 'package:flutter/material.dart';

import '../shopping/store_list_screen.dart';
import '../tickets/listing_list_screen.dart';
import 'coming_soon_screen.dart';
import 'profile_screen.dart';

/// Bottom-nav shell — Profile, Shopping and Tickets are real (core-go's
/// Phase 0 auth + Phase 1 shopping/ticketing endpoints); Groups stays an
/// honest placeholder until core-go's groups/treasury API ships (see
/// docs/adr/0005-mobile-api-in-go.md — that's a separate, larger piece
/// of work not part of this round).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _tabs = [
    (icon: Icons.badge_outlined, label: 'Profile'),
    (icon: Icons.groups_outlined, label: 'Groups'),
    (icon: Icons.storefront_outlined, label: 'Shopping'),
    (icon: Icons.confirmation_num_outlined, label: 'Tickets'),
  ];

  Widget _body(int index) {
    switch (index) {
      case 0:
        return const ProfileScreen();
      case 1:
        return const ComingSoonScreen(
          title: 'Groups',
          icon: Icons.groups_outlined,
          description: 'Chama membership, contributions and withdrawals are coming to '
              'the app once core-go\'s groups/treasury API ships.',
        );
      case 2:
        return const StoreListScreen();
      case 3:
        return const ListingListScreen();
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
