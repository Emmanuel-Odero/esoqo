import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/auth/org_context_state.dart';
import '../../core/theme/esoqo_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../home/org_duty_switcher_screen.dart';
import '../scan/scan_sheet.dart';
import 'fleet_providers.dart';
import 'fleet_repository.dart';
import 'verify_fare_screen.dart';

final myActiveTripProvider = FutureProvider.autoDispose<MyTrip?>(
  (ref) => ref.watch(fleetRepositoryProvider).myActiveTrip(),
);

/// The tout's whole day: which trip they're on, a running collections
/// tally, +cash, verify, end shift. Reached from Home once a person has
/// switched on CREW duty for an organisation (Profile > Acting as — see
/// core/auth/org_context_state.dart) — unlike the retired AGENT PIN
/// login this used to require, a crew member stays fully signed in as
/// themselves and can still reach the rest of the app; this screen is
/// just where their shift lives, not a device lockdown.
class CrewShiftScreen extends ConsumerWidget {
  const CrewShiftScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth is AuthSignedIn ? auth.profile : null;
    final active = ref.watch(orgContextControllerProvider).active;

    return Scaffold(
      // Blue while on duty, same tint the Home app bar picks up — the
      // bar itself says "you're in an org context" here too, not just
      // the fact of being on this screen at all.
      appBar: EsoqoAppBar(
        title: profile?.displayName ?? 'Your shift',
        backgroundColor: active != null ? EsoqoColors.blue : null,
        actions: [
          // The switcher stays reachable even mid-shift — being on duty
          // must never mean losing the way to other roles, which
          // "End duty" replacing it outright used to do.
          const HatsIconButton(color: Colors.white),
          if (active != null) _EndDutyButton(orgId: active.orgId),
          const SizedBox(width: EsoqoSpacing.s2),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(myActiveTripProvider),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: ListView(
                padding: const EdgeInsets.all(EsoqoSpacing.s4),
                children: [
                  if (active == null || !active.isCrew)
                    const EsoqoEmptyState(
                      message: 'Not on CREW duty right now — switch it on from Profile > Acting as.',
                      icon: Icons.badge_outlined,
                    )
                  else
                    _Shift(active: active),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A deliberate, hard-to-mistake-for-plain-text action — this ends the
/// activation itself (see OrgContextController.endDuty's own comment:
/// the *next* switch-in for this org, on any device, needs a fresh OTP
/// after this), which is a bigger deal than the old bare white
/// [TextButton] made it look. A red-tinted pill with a real icon reads
/// as "this ends something," matching SCREEN_CONVENTIONS.md's rule that
/// red is for attention-worthy, not passive, actions.
class _EndDutyButton extends ConsumerWidget {
  const _EndDutyButton({required this.orgId});
  final String orgId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(left: EsoqoSpacing.s1),
      child: Material(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(EsoqoRadius.pill),
        child: InkWell(
          borderRadius: BorderRadius.circular(EsoqoRadius.pill),
          onTap: () => _confirmEndDuty(context, ref),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: EsoqoSpacing.s3, vertical: EsoqoSpacing.s2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.logout, size: 16, color: Colors.white),
                SizedBox(width: 6),
                Text('End duty', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: EsoqoTypeScale.label)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _confirmEndDuty(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('End duty?'),
        content: const Text(
          'This ends your access for this organisation right now — switching back in later will need a fresh code, even before it would otherwise expire.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('End duty')),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(orgContextControllerProvider.notifier).endDuty(orgId);
    if (context.mounted) Navigator.of(context).maybePop();
  }
}

class _Shift extends ConsumerWidget {
  const _Shift({required this.active});
  final ActiveOrgContext active;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trip = ref.watch(myActiveTripProvider);
    return EsoqoAsyncView(
      value: trip,
      isEmpty: (t) => t == null,
      emptyMessage:
          'No active trip yet — ask your dispatcher to start one for your vehicle.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(myActiveTripProvider),
      data: (context, t) => _ShiftBody(active: active, trip: t!),
    );
  }
}

class _ShiftBody extends ConsumerStatefulWidget {
  const _ShiftBody({required this.active, required this.trip});
  final ActiveOrgContext active;
  final MyTrip trip;

  @override
  ConsumerState<_ShiftBody> createState() => _ShiftBodyState();
}

class _ShiftBodyState extends ConsumerState<_ShiftBody> {
  bool _busy = false;
  String? _notice;

  Future<void> _declareCash() async {
    final crewId = widget.active.crewMemberId;
    if (crewId == null) {
      setState(
        () => _notice = 'Your manager hasn\'t linked your account to a crew record yet — ask them before declaring cash.',
      );
      return;
    }
    final amount = await showAmountDialog(context, title: 'Cash counted');
    if (amount == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await ref.read(fleetRepositoryProvider).declareCash(
            tripId: widget.trip.id,
            crewId: crewId,
            amountKes: amount,
          );
      ref.invalidate(collectionsProvider(widget.trip.id));
      setState(() => _notice = 'Recorded KES ${amount.toStringAsFixed(0)}.');
    } on ApiException catch (e) {
      setState(() => _notice = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _endShift() async {
    final result = await showEndShiftDialog(context);
    if (result == null) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await ref.read(fleetRepositoryProvider).closeTrip(
            widget.trip.id,
            note: result.note,
            endStatus: result.endStatus,
          );
      ref.invalidate(myActiveTripProvider);
      if (mounted) {
        setState(() => _notice = 'Shift closed. Have a good one.');
      }
    } on ApiException catch (e) {
      setState(() => _notice = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final summary = ref.watch(collectionsProvider(trip.id));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EsoqoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(trip.vehiclePlate, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(trip.routeName ?? 'No route set'),
              Text(
                'On duty since ${trip.startedAt}',
                style: TextStyle(color: Theme.of(context).textTheme.bodySmall?.color),
              ),
            ],
          ),
        ),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoSectionHeader(title: 'This shift', subtitle: 'Fares confirmed vs cash counted.'),
        const SizedBox(height: EsoqoSpacing.s2),
        summary.when(
          data: (s) => EsoqoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('M-Pesa confirmed'),
                    EsoqoAmountText(s.mpesaConfirmedKes, fontSize: EsoqoTypeScale.subTitle),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Cash fares'),
                    EsoqoAmountText(s.cashFaresKes, fontSize: EsoqoTypeScale.subTitle),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Cash declared'),
                    EsoqoAmountText(s.declaredCashKes, fontSize: EsoqoTypeScale.subTitle),
                  ],
                ),
                if (s.hasVariance) ...[
                  const SizedBox(height: EsoqoSpacing.s2),
                  EsoqoStatusPill(
                    label: 'Variance KES ${s.cashVarianceKes}',
                    color: Theme.of(context).colorScheme.error,
                    icon: Icons.error_outline,
                  ),
                ],
              ],
            ),
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => const EsoqoFormError(message: 'Could not load the tally.'),
        ),
        const SizedBox(height: EsoqoSpacing.s4),
        EsoqoButton.primary(
          expand: false,
          label: 'Declare cash counted',
          icon: Icons.payments_outlined,
          loading: _busy,
          onPressed: _declareCash,
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoButton.primary(
          expand: false,
          label: 'Verify a fare',
          icon: Icons.verified_outlined,
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => VerifyFareScreen(scopeTripId: trip.id),
            ),
          ),
        ),
        const SizedBox(height: EsoqoSpacing.s3),
        EsoqoButton.primary(
          expand: false,
          label: 'Scan a passenger receipt',
          icon: Icons.qr_code_scanner_outlined,
          onPressed: () => showScanSheet(context),
        ),
        const SizedBox(height: EsoqoSpacing.s5),
        // Gated by showEndShiftDialog, which collects the note and end
        // status — so no second confirmation here.
        EsoqoButton.destructiveGated(
          label: 'End shift',
          icon: Icons.flag_outlined,
          loading: _busy,
          onPressed: _endShift,
        ),
        if (_notice != null) ...[
          const SizedBox(height: EsoqoSpacing.s3),
          Text(_notice!, textAlign: TextAlign.center),
        ],
      ],
    );
  }
}

class EndShiftResult {
  const EndShiftResult({required this.endStatus, this.note});
  final String endStatus;
  final String? note;
}

/// Three quick-chip codes plus an optional note — matches the vehicle's
/// TripEndStatus enum on the server 1:1 (OK / NEEDS_FUEL / NEEDS_REPAIR)
/// so a fleet owner can scan a day's worth of trips for anything
/// needing attention without reading every note.
Future<EndShiftResult?> showEndShiftDialog(BuildContext context) {
  String selected = 'OK';
  final noteController = TextEditingController();
  return showDialog<EndShiftResult>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('End shift'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('How\'s the vehicle?'),
            const SizedBox(height: EsoqoSpacing.s2),
            Wrap(
              spacing: EsoqoSpacing.s2,
              children: [
                for (final option in const [
                  ('OK', 'OK'),
                  ('NEEDS_FUEL', 'Needs fuel'),
                  ('NEEDS_REPAIR', 'Needs repair'),
                ])
                  ChoiceChip(
                    label: Text(option.$2),
                    selected: selected == option.$1,
                    onSelected: (_) => setState(() => selected = option.$1),
                  ),
              ],
            ),
            const SizedBox(height: EsoqoSpacing.s4),
            TextField(
              controller: noteController,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(
              EndShiftResult(
                endStatus: selected,
                note: noteController.text.trim().isEmpty ? null : noteController.text.trim(),
              ),
            ),
            child: const Text('Close trip'),
          ),
        ],
      ),
    ),
  );
}
