import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/scan_access.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'fleet_repository.dart';

/// Tout verify: scan receipt QR or type M-Pesa / fare code.
/// POST /v1/fares/verify — Go owns TTL (90 min), trip match, reuse flags.
class VerifyFareScreen extends ConsumerStatefulWidget {
  const VerifyFareScreen({super.key, this.scopeTripId = ''});
  final String scopeTripId;

  @override
  ConsumerState<VerifyFareScreen> createState() => _VerifyFareScreenState();
}

class _VerifyFareScreenState extends ConsumerState<VerifyFareScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  Map<String, dynamic>? _result;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify(String code) async {
    if (code.trim().isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _result = null;
    });
    try {
      final verification = await ref
          .read(fleetRepositoryProvider)
          .verifyFare(code, widget.scopeTripId);
      setState(() => _result = verification);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Color _color(String s, BuildContext c) {
    final cs = Theme.of(c).colorScheme;
    return switch (s) {
      'VALID' => EsokoColors.green,
      'EXPIRED' || 'FAILED' || 'NOT_FOUND' => cs.error,
      _ => EsokoColors.amber,
    };
  }

  @override
  Widget build(BuildContext context) {
    final v = _result;
    final reduced = MediaQuery.disableAnimationsOf(context);
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    // Reached without the grant (e.g. via a quick action): say so
    // plainly. The server still answers own-receipt checks, so the
    // screen stays useful instead of dead-ending. canVerifyFare already
    // reflects an activated CREW/SCANNER org context (see core/auth/
    // org_context_state.dart) — the capability shows up on the profile
    // the moment GET /v1/me is called with the org-context header
    // attached, no separate agent-session check needed any more.
    final crew = canVerifyFare(profile);
    return Scaffold(
      appBar: const EsokoAppBar(title: 'Verify fare'),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(EsokoSpacing.s4),
          children: [
            if (!crew)
              const EsokoCard(
                child: Padding(
                  padding: EdgeInsets.all(EsokoSpacing.s4),
                  child: Text(
                    'Crew feature — switch on staff duty (Profile > Acting as) to verify any fare. You can still check your own receipts here.',
                  ),
                ),
              ),
            const EsokoPageLead(
              'Scan the passenger receipt or type the M-Pesa code.',
            ),
            const SizedBox(height: EsokoSpacing.s4),
            SizedBox(
              height: 220,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(EsokoRadius.md),
                child: MobileScanner(
                  onDetect: (cap) {
                    final raw = cap.barcodes.firstOrNull?.rawValue;
                    if (raw != null) _verify(raw);
                  },
                ),
              ),
            ),
            const SizedBox(height: EsokoSpacing.s4),
            Row(
              children: [
                Expanded(
                  child: EsokoField.code(
                    controller: _code,
                    label: 'Receipt / M-Pesa code',
                    hint: 'e.g. QHX7AB12CD',
                    onSubmitted: _verify,
                  ),
                ),
                const SizedBox(width: EsokoSpacing.s2),
                // Fixed width, not a bare Row child — see
                // parcels_hub_screen.dart's comment on the "BoxConstraints
                // forces an infinite width" FilledButton-in-a-Row bug.
                SizedBox(
                  width: 96,
                  child: EsokoButton.primary(
                    expand: false,
                    label: 'Verify',
                    loading: _busy,
                    onPressed: () => _verify(_code.text),
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: EsokoSpacing.s3),
              EsokoFormError(message: _error!),
            ],
            if (v != null) ...[
              const SizedBox(height: EsokoSpacing.s4),
              // Successive scans cross-fade between verdicts instead of
              // snapping — the tout reads VALID vs EXPIRED at a glance.
              AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsokoMotion.medium,
                switchInCurve: EsokoMotion.easeOut,
                switchOutCurve: EsokoMotion.easeOut,
                child: KeyedSubtree(
                  key: ValueKey(v['status']),
                  child: EsokoCard(
                color: _color(
                  (v['status'] as String?) ?? '',
                  context,
                ).withValues(alpha: 0.10),
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${v['status']} · KES ${v['amountKes'] ?? ''}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 4),
                    Text('${v['orgName'] ?? ''} · ${v['vehiclePlate'] ?? ''}'),
                    Text(
                      '${v['routeName'] ?? '—'} · ${v['ageMinutes']} min ago · via ${v['method'] ?? ''}',
                    ),
                    Text('Receipt: ${v['receiptCode'] ?? v['fareId'] ?? ''}'),
                    if (v['driverName'] != null || v['conductorName'] != null)
                      Text(
                        'Driver: ${v['driverName'] ?? '—'} · Tout: ${v['conductorName'] ?? '—'}',
                      ),
                    if ((v['verifyCount'] as int? ?? 0) > 1)
                      Text(
                        'Shown ${v['verifyCount']}× — check reuse.',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                  ],
                ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
