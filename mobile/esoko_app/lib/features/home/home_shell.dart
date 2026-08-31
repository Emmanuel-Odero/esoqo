import 'package:flutter/material.dart';

import '../bills/bills_list_screen.dart';
import '../groups/my_groups_screen.dart';
import '../shopping/store_list_screen.dart';
import '../tickets/listing_list_screen.dart';
import 'profile_screen.dart';

/// Bottom-nav shell — every tab is real now (core-go's Phase 0 auth +
/// Phase 1 shopping/ticketing + this round's groups/treasury/bills). See
/// docs/adr/0005-mobile-api-in-go.md.
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
    (icon: Icons.receipt_long_outlined, label: 'Bills'),
  ];

  Widget _body(int index) {
    switch (index) {
      case 0:
        return const ProfileScreen();
      case 1:
        return const MyGroupsScreen();
      case 2:
        return const StoreListScreen();
      case 3:
        return const ListingListScreen();
      case 4:
        return const BillsListScreen();
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
