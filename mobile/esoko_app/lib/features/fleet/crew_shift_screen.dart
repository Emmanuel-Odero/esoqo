import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/agent_session.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import '../scan/scan_sheet.dart';
import 'fleet_providers.dart';
import 'fleet_repository.dart';
import 'verify_fare_screen.dart';

final myActiveTripProvider = FutureProvider.autoDispose<MyTrip?>(
  (ref) => ref.watch(fleetRepositoryProvider).myActiveTrip(),
);

/// The tout's whole day: one screen, everything a crew session actually
/// needs — which trip they're on, a running collections tally, +cash,
/// verify, end shift. Booted straight into by the router the moment an
/// agent session is signed in (see core/router.dart) — a crew phone
/// never sees the five-tile consumer hub, per the journey-map memo's
/// "a scoped session sees only its scope" rule.
class CrewShiftScreen extends ConsumerWidget {
  const CrewShiftScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agent = ref.watch(agentSessionControllerProvider);
    final session = agent is AgentSignedIn ? agent.session : null;

    return Scaffold(
      appBar: EsokoAppBar(
        title: session?.name ?? 'My shift',
        actions: [
          TextButton(
            onPressed: () => ref.read(agentSessionControllerProvider.notifier).signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(myActiveTripProvider),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: ListView(
                padding: const EdgeInsets.all(EsokoSpacing.s4),
                children: [
                  if (session == null)
                    const EsokoFormError(message: 'Session not found — please sign in again.')
                  else
                    _Shift(session: session),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Shift extends ConsumerWidget {
  const _Shift({required this.session});
  final AgentSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trip = ref.watch(myActiveTripProvider);
    return EsokoAsyncView(
      value: trip,
      isEmpty: (t) => t == null,
      emptyMessage:
          'No active trip yet — ask your dispatcher to start one for your vehicle.',
      emptyIcon: Icons.directions_bus_outlined,
      onRetry: () => ref.invalidate(myActiveTripProvider),
      data: (context, t) => _ShiftBody(session: session, trip: t!),
    );
  }
}

class _ShiftBody extends ConsumerStatefulWidget {
  const _ShiftBody({required this.session, required this.trip});
  final AgentSession session;
  final MyTrip trip;

  @override
  ConsumerState<_ShiftBody> createState() => _ShiftBodyState();
}

class _ShiftBodyState extends ConsumerState<_ShiftBody> {
  bool _busy = false;
  String? _notice;

  Future<void> _declareCash() async {
    final crewId = widget.session.crewMemberId;
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
        EsokoCard(
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
        const SizedBox(height: EsokoSpacing.s4),
        EsokoSectionHeader(title: 'This shift', subtitle: 'Fares confirmed vs cash counted.'),
        const SizedBox(height: EsokoSpacing.s2),
        summary.when(
          data: (s) => EsokoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('M-Pesa confirmed'),
                    EsokoAmountText(s.mpesaConfirmedKes, fontSize: 16),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Cash fares'),
                    EsokoAmountText(s.cashFaresKes, fontSize: 16),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Cash declared'),
                    EsokoAmountText(s.declaredCashKes, fontSize: 16),
                  ],
                ),
                if (s.hasVariance) ...[
                  const SizedBox(height: EsokoSpacing.s2),
                  EsokoStatusPill(
                    label: 'Variance KES ${s.cashVarianceKes}',
                    color: Theme.of(context).colorScheme.error,
                    icon: Icons.error_outline,
                  ),
                ],
              ],
            ),
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => const EsokoFormError(message: 'Could not load the tally.'),
        ),
        const SizedBox(height: EsokoSpacing.s4),
        EsokoLoadingButton(
          label: 'Declare cash counted',
          icon: Icons.payments_outlined,
          loading: _busy,
          onPressed: _declareCash,
        ),
        const SizedBox(height: EsokoSpacing.s3),
        EsokoLoadingButton(
          label: 'Verify a fare',
          icon: Icons.verified_outlined,
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => VerifyFareScreen(scopeTripId: trip.id),
            ),
          ),
        ),
        const SizedBox(height: EsokoSpacing.s3),
        EsokoLoadingButton(
          label: 'Scan a passenger receipt',
          icon: Icons.qr_code_scanner_outlined,
          onPressed: () => showScanSheet(context),
        ),
        const SizedBox(height: EsokoSpacing.s5),
        OutlinedButton.icon(
          onPressed: _busy ? null : _endShift,
          icon: const Icon(Icons.flag_outlined),
          label: const Text('End shift'),
        ),
        if (_notice != null) ...[
          const SizedBox(height: EsokoSpacing.s3),
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
            const SizedBox(height: EsokoSpacing.s2),
            Wrap(
              spacing: EsokoSpacing.s2,
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
            const SizedBox(height: EsokoSpacing.s4),
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
