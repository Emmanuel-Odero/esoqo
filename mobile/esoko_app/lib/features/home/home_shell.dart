import 'package:flutter/material.dart';

import '../../core/widgets/widgets.dart';
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

  // Built once, not per switch — an IndexedStack keeps every tab
  // mounted (just hidden) instead of disposing and reconstructing the
  // outgoing tab, which is what made switching tabs feel like a fresh
  // reload: each tab's FutureProvider.autoDispose watchers were torn
  // down and refetched from scratch every time, losing scroll
  // position and in-flight search text along with it. Staying mounted
  // is what keeps those providers alive across a switch, for free.
  static const _screens = [
    ProfileScreen(),
    MyGroupsScreen(),
    StoreListScreen(),
    ListingListScreen(),
    BillsListScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: EsokoAppBar(title: _tabs[_index].label),
      body: SafeArea(child: IndexedStack(index: _index, children: _screens)),
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
