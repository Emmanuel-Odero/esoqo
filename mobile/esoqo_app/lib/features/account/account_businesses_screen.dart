import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../fleet/fleet_models.dart';
import '../fleet/fleet_providers.dart';
import '../fleet/org_fleet_screen.dart';
import '../home/org_duty_switcher_screen.dart';

/// Companies you own, and staff duty you can switch on.
///
/// Consolidates what used to be scattered across the app: companies
/// the signed-in person owns (previously only discoverable inside
/// whichever vertical tab they happened to live under — Transport for
/// a fleet company, nowhere at all on mobile for an events company)
/// and staff duty grants (previously a single unlabelled "Acting as"
/// row). One place, per docs/proposals/esoko-unified-crew-identity.md's
/// "log in once, see everything you're entitled to" intent.
///
/// The Account hub only offers this door when there is something
/// behind it, so this screen never has to render an empty state for
/// the common case of a plain subject.
class AccountBusinessesScreen extends ConsumerWidget {
  const AccountBusinessesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orgs = ref.watch(myOrgsProvider).valueOrNull ?? const <OrgSummary>[];
    final grants = ref.watch(orgContextControllerProvider).grants;

    return Scaffold(
      appBar: const EsokoAppBar(title: 'Your businesses'),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await ref.read(orgContextControllerProvider.notifier).refreshGrants();
            ref.invalidate(myOrgsProvider);
          },
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 840),
              child: ListView(
                padding: const EdgeInsets.all(EsokoSpacing.s6),
                children: [
                  if (orgs.isNotEmpty) ...[
                    const EsokoSubHeader('Companies you own'),
                    const SizedBox(height: EsokoSpacing.s3),
                    for (final org in orgs) _ownedOrgTile(context, org),
                    const SizedBox(height: EsokoSpacing.s5),
                  ],
                  if (grants.isNotEmpty) ...[
                    const EsokoSubHeader('Duty you can switch on'),
                    const SizedBox(height: EsokoSpacing.s3),
                    for (final grant in grants) _grantTile(context, grant),
                    const SizedBox(height: EsokoSpacing.s3),
                    EsokoButton.secondary(
                      label: 'Switch duty',
                      icon: Icons.swap_horiz,
                      onPressed: () => showHatsQuickSwitchSheet(context),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // Blue, not green — SCREEN_CONVENTIONS.md's colour rule: a company is
  // an institution, not the person's own record, even when they own it.
  Widget _ownedOrgTile(BuildContext context, OrgSummary org) {
    final manageable = org.vertical == 'TRANSPORT';
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: org.name,
        subtitle: '${org.vertical} · ${org.status}',
        iconColor: EsokoColors.blue,
        iconBackground: EsokoColors.blueTint,
        icon: Icons.storefront_outlined,
        trailing: manageable
            ? null
            : const EsokoStatusPill(
                label: 'Web console',
                color: EsokoColors.blue,
              ),
        onTap: manageable
            ? () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        OrgFleetScreen(orgId: org.id, orgName: org.name),
                  ),
                )
            : () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Manage this company from the Esoko web console for now.',
                    ),
                  ),
                ),
      ),
    );
  }

  Widget _grantTile(BuildContext context, OrgGrant grant) {
    return Padding(
      padding: const EdgeInsets.only(bottom: EsokoSpacing.s2),
      child: EsokoListTile(
        title: grant.orgName,
        subtitle: grant.suspended
            ? 'Suspended'
            : '${grant.role}${grant.active ? ' · on duty' : ''}',
        iconColor: EsokoColors.blue,
        iconBackground: EsokoColors.blueTint,
        icon: Icons.badge_outlined,
        trailing: grant.suspended
            ? const EsokoStatusPill(label: 'Suspended', color: EsokoColors.red)
            : grant.active
                ? const EsokoStatusPill(
                    label: 'On duty',
                    color: EsokoColors.green,
                  )
                : null,
      ),
    );
  }
}
