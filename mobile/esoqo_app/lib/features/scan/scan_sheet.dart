import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoqo_tokens.dart';
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
        // canVerifyFare already reflects an activated org-staff context
        // (see core/auth/org_context_state.dart): the fare.verify/
        // ticketorg.read capability shows up on the profile the moment
        // GET /v1/me is called with the org-context header attached —
        // no separate agent-session check needed any more.
        final crew = canVerifyFare(profile);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(EsoqoSpacing.s4),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                EsoqoSectionHeader(
                  title: 'Scan',
                  subtitle: crew
                      ? 'Board, pay, or verify a fare.'
                      : 'Point at any Esoqo code — bus, shelf, or table.',
                ),
                const SizedBox(height: EsoqoSpacing.s3),
                EsoqoListTile(
                  title: 'Scan a code',
                  subtitle: 'Bus QR, product barcode, table code, voucher.',
                  leading: const EsoqoQuickActionIcon(
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
                  const SizedBox(height: EsoqoSpacing.s2),
                  EsoqoListTile(
                    title: 'Verify fare',
                    subtitle: 'Crew: scan a passenger receipt or M-Pesa code.',
                    leading: const EsoqoQuickActionIcon(
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
                const SizedBox(height: EsoqoSpacing.s2),
              ],
            ),
          ),
        );
      },
    ),
  );
}
