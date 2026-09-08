import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/agent_session.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'universal_scan_screen.dart';
import '../fleet/verify_fare_screen.dart';

/// The one-tap scanner entry. Passengers see only the universal scanner
/// (bus QR, vouchers, shelf barcodes, table codes — resolving is public
/// and paying uses their own wallet). The crew-only Verify fare shortcut
/// renders only for profiles holding the grant; the server enforces the
/// same rule, so this is convenience, never the boundary.
Future<void> showScanSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => Consumer(
      builder: (context, ref, _) {
        final auth = ref.watch(authControllerProvider);
        final profile = auth is AuthSignedIn ? auth.profile : null;
        final agent = ref.watch(agentSessionControllerProvider);
        final crew = canVerifyFare(profile) || agent is AgentSignedIn;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(EsokoSpacing.s4),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                EsokoSectionHeader(
                  title: 'Scan',
                  subtitle: crew
                      ? 'Board, pay, or verify a fare.'
                      : 'Point at any Esoko code — bus, shelf, or table.',
                ),
                const SizedBox(height: EsokoSpacing.s3),
                EsokoListTile(
                  title: 'Scan a code',
                  subtitle: 'Bus QR, product barcode, table code, voucher.',
                  leading: const EsokoQuickActionIcon(
                    icon: Icons.qr_code_scanner_outlined,
                  ),
                  onTap: () {
                    Navigator.of(context).pop();
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const UniversalScanScreen(),
                      ),
                    );
                  },
                ),
                if (crew) ...[
                  const SizedBox(height: EsokoSpacing.s2),
                  EsokoListTile(
                    title: 'Verify fare',
                    subtitle: 'Crew: scan a passenger receipt or M-Pesa code.',
                    leading: const EsokoQuickActionIcon(
                      icon: Icons.verified_outlined,
                    ),
                    onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const VerifyFareScreen(),
                        ),
                      );
                    },
                  ),
                ],
                const SizedBox(height: EsokoSpacing.s2),
              ],
            ),
          ),
        );
      },
    ),
  );
}
