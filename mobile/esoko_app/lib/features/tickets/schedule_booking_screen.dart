import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import '../../core/widgets/widgets.dart';
import 'ticketing_models.dart';
import 'ticketing_repository.dart';

final scheduleSeatsProvider = FutureProvider.autoDispose
    .family<SeatMapResult, String>(
      (ref, scheduleId) =>
          ref.watch(ticketingRepositoryProvider).seats(scheduleId),
    );

enum _Stage { pick, details, waiting, done, failed }

/// Picks a ticket class (+ seat, if seated) for one schedule, then books
/// and pays — POST /v1/bookings → M-Pesa STK → poll GET /v1/bookings/:id.
class ScheduleBookingScreen extends ConsumerStatefulWidget {
  const ScheduleBookingScreen({
    super.key,
    required this.scheduleId,
    required this.ticketClasses,
    required this.listingTitle,
  });
  final String scheduleId;
  final List<TicketClass> ticketClasses;
  final String listingTitle;

  @override
  ConsumerState<ScheduleBookingScreen> createState() =>
      _ScheduleBookingScreenState();
}

class _ScheduleBookingScreenState extends ConsumerState<ScheduleBookingScreen> {
  TicketClass? _selectedClass;
  String? _selectedSeatId;
  int _quantity = 1;
  _Stage _stage = _Stage.pick;
  String? _error;
  String? _bookingId;
  String? _totalKes;
  Timer? _pollTimer;

  final _nameController = TextEditingController();
  final _msisdnController = TextEditingController();
  final _voucherCodeController = TextEditingController();
  String _method = 'MPESA_STK';

  @override
  void initState() {
    super.initState();
    _selectedClass = widget.ticketClasses.isNotEmpty
        ? widget.ticketClasses.first
        : null;
    final auth = ref.read(authControllerProvider);
    if (auth is AuthSignedIn) {
      _nameController.text = auth.profile.displayName;
      _msisdnController.text = auth.profile.msisdn ?? '';
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _nameController.dispose();
    _msisdnController.dispose();
    _voucherCodeController.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    final tc = _selectedClass;
    if (tc == null) return;
    setState(() {
      _stage = _Stage.waiting;
      _error = null;
    });
    try {
      final repo = ref.read(ticketingRepositoryProvider);
      String? voucherId;
      if (_method == 'VOUCHER') {
        voucherId = await repo.resolveVoucherCode(_voucherCodeController.text);
        if (voucherId == null) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'Voucher not found — check the code.';
          });
          return;
        }
      }
      final placed = await repo.placeBooking(
        scheduleId: widget.scheduleId,
        ticketClassId: tc.id,
        seatId: _selectedSeatId,
        quantity: tc.seated ? 1 : _quantity,
        buyerName: _nameController.text.trim(),
        buyerMsisdn: _msisdnController.text.trim(),
        paymentMethod: _method,
        voucherId: voucherId,
      );
      _bookingId = placed.bookingId;
      _totalKes = placed.totalKes;
      if (placed.paid) {
        setState(() => _stage = _Stage.done);
        return;
      }
      _startPolling();
    } on ApiException catch (e) {
      setState(() {
        _stage = _Stage.failed;
        _error = e.message;
      });
    }
  }

  void _startPolling() {
    var attempts = 0;
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (timer) async {
      attempts++;
      if (_bookingId == null || attempts > 15) {
        timer.cancel();
        // Don't strand the user on an indefinite spinner — surface a
        // recoverable failure with retry (same contract as checkout).
        if (mounted && _stage == _Stage.waiting) {
          setState(() {
            _stage = _Stage.failed;
            _error = 'We could not confirm your M-Pesa payment. If you were charged, it will appear in My tickets — otherwise try again.';
          });
        }
        return;
      }
      try {
        final repo = ref.read(ticketingRepositoryProvider);
        if (await repo.isBookingPaid(_bookingId!)) {
          timer.cancel();
          if (mounted) setState(() => _stage = _Stage.done);
        }
      } on ApiException {
        // transient — keep polling until the attempt cap above
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: EsokoAppBar(title: widget.listingTitle),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(EsokoSpacing.s5),
              // Same contract as checkout: the stage machine
              // cross-fades, money never visually jumps.
              child: AnimatedSwitcher(
                duration: reduced ? Duration.zero : EsokoMotion.medium,
                switchInCurve: EsokoMotion.easeOut,
                switchOutCurve: EsokoMotion.easeOut,
                child: KeyedSubtree(
                  key: ValueKey(_stage),
                  child: _body(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_stage) {
      case _Stage.pick:
        return _pickStage();
      case _Stage.details:
        return _detailsStage();
      case _Stage.waiting:
        return EsokoResultView.waiting(
          title: 'Complete payment on your phone',
          message: 'Enter your M-Pesa PIN when the prompt arrives.',
          amountKes: _totalKes,
        );
      case _Stage.done:
        return EsokoResultView.success(
          title: 'Booking confirmed',
          message: 'Find your ticket QR any time under Tickets → My tickets.',
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).popUntil((r) => r.isFirst),
        );
      case _Stage.failed:
        return EsokoResultView.failure(
          errorMessage: _error ?? 'Something went wrong',
          primaryLabel: 'Start over',
          onPrimary: () => setState(() => _stage = _Stage.pick),
        );
    }
  }

  Widget _pickStage() {
    final tc = _selectedClass;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Choose a ticket type',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: EsokoSpacing.s3),
        for (final c in widget.ticketClasses)
          _TicketClassOption(
            ticketClass: c,
            selected: tc?.id == c.id,
            onTap: () {
              EsokoHaptics.tap();
              setState(() {
                _selectedClass = c;
                _selectedSeatId = null;
              });
            },
          ),
        if (tc != null && tc.seated) ...[
          const SizedBox(height: EsokoSpacing.s4),
          Text('Choose a seat', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: EsokoSpacing.s3),
          _seatPicker(tc.id),
        ] else if (tc != null) ...[
          const SizedBox(height: EsokoSpacing.s4),
          Text('Quantity', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: EsokoSpacing.s2),
          Center(
            child: EsokoStepper(
              value: _quantity,
              onChanged: (v) => setState(() => _quantity = v),
            ),
          ),
        ],
        const SizedBox(height: EsokoSpacing.s5),
        FilledButton(
          onPressed: tc == null || (tc.seated && _selectedSeatId == null)
              ? null
              : () => setState(() => _stage = _Stage.details),
          child: const Text('Continue'),
        ),
      ],
    );
  }

  Widget _seatPicker(String ticketClassId) {
    final seatMap = ref.watch(scheduleSeatsProvider(widget.scheduleId));
    return seatMap.when(
      data: (map) {
        final forClass = map.seats
            .where((s) => s.ticketClassId == ticketClassId)
            .toList();
        if (forClass.isEmpty) {
          return Text(
            'No seats configured for this class.',
            style: TextStyle(color: EsokoColors.text2),
          );
        }
        final byRow = <int, List<SeatRow>>{};
        for (final s in forClass) {
          byRow.putIfAbsent(s.row, () => []).add(s);
        }
        final rows = byRow.keys.toList()..sort();
        for (final r in rows) {
          byRow[r]!.sort((a, b) => a.column.compareTo(b.column));
        }
        final leftCols = map.leftColumns.toSet();

        return Column(
          children: [
            Container(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              decoration: BoxDecoration(
                color: EsokoColors.paper,
                borderRadius: BorderRadius.circular(EsokoRadius.lg),
                border: Border.all(color: EsokoColors.line),
              ),
              child: Column(
                children: [
                  // Front-of-bus/hall indicator — a curved cap so the
                  // seat grid below reads as an actual vehicle/venue
                  // shape, not just a table of buttons.
                  Container(
                    width: 72,
                    padding: const EdgeInsets.symmetric(
                      vertical: EsokoSpacing.s2,
                    ),
                    decoration: BoxDecoration(
                      color: EsokoColors.line,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(20),
                      ),
                    ),
                    child: Column(
                      children: [
                        Icon(
                          Icons.airline_seat_recline_normal,
                          color: EsokoColors.text3,
                          size: 18,
                        ),
                        Text(
                          'FRONT',
                          style: TextStyle(
                            fontSize: 9,
                            letterSpacing: 2,
                            color: EsokoColors.text3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: EsokoSpacing.s4),
                  for (final r in rows) ...[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(
                          width: 18,
                          child: Text(
                            '$r',
                            style: TextStyle(
                              fontSize: 10,
                              color: EsokoColors.text3,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                        const SizedBox(width: EsokoSpacing.s2),
                        for (final seat in byRow[r]!) ...[
                          _SeatButton(
                            seat: seat,
                            selected: _selectedSeatId == seat.id,
                            onTap: () {
                              EsokoHaptics.tap();
                              setState(() => _selectedSeatId = seat.id);
                            },
                          ),
                          // Aisle gap right after the last left-side
                          // column, before the first right-side column.
                          if (leftCols.contains(seat.column) &&
                              byRow[r]!.indexOf(seat) == leftCols.length - 1)
                            const SizedBox(width: EsokoSpacing.s5)
                          else
                            const SizedBox(width: EsokoSpacing.s2),
                        ],
                      ],
                    ),
                    const SizedBox(height: EsokoSpacing.s2),
                  ],
                ],
              ),
            ),
            const SizedBox(height: EsokoSpacing.s3),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _seatLegend(EsokoColors.line, 'Taken'),
                const SizedBox(width: EsokoSpacing.s4),
                _seatLegend(EsokoColors.paper, 'Available', outline: true),
                const SizedBox(width: EsokoSpacing.s4),
                _seatLegend(EsokoColors.green, 'Selected'),
              ],
            ),
          ],
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.all(EsokoSpacing.s1),
        child: EsokoSkeletonCard(lines: 4),
      ),
      error: (e, _) => EsokoFormError(
        message: e is ApiException ? e.message : 'Could not load seats.',
      ),
    );
  }

  Widget _seatLegend(Color color, String label, {bool outline = false}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 14,
          height: 14,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
            border: outline
                ? Border.all(color: EsokoColors.line, width: 1.5)
                : null,
          ),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(fontSize: 11, color: EsokoColors.text2)),
      ],
    );
  }

  Widget _detailsStage() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        EsokoPaymentMethodToggle<String>(
          selected: _method,
          onChanged: (m) => setState(() => _method = m),
          options: const [('MPESA_STK', 'M-Pesa'), ('VOUCHER', 'Voucher')],
        ),
        if (_method == 'VOUCHER') ...[
          const SizedBox(height: 12),
          EsokoFormField(
            controller: _voucherCodeController,
            label: 'Voucher code',
            hint: 'e.g. VCH-XXXXXX',
            icon: Icons.wallet_outlined,
          ),
        ],
        const SizedBox(height: 12),
        EsokoPayerFields(
          nameController: _nameController,
          msisdnController: _msisdnController,
          payLabel: _method == 'VOUCHER'
              ? 'Pay with voucher'
              : 'Pay with M-Pesa',
          onPay: _book,
        ),
      ],
    );
  }
}

class _TicketClassOption extends StatelessWidget {
  const _TicketClassOption({
    required this.ticketClass,
    required this.selected,
    required this.onTap,
  });
  final TicketClass ticketClass;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? EsokoColors.greenTint : Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(EsokoRadius.lg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.only(bottom: EsokoSpacing.s2),
          padding: const EdgeInsets.all(EsokoSpacing.s3),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? EsokoColors.green : EsokoColors.line,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? EsokoColors.green : EsokoColors.text3,
                size: 22,
              ),
              const SizedBox(width: EsokoSpacing.s3),
              Icon(
                ticketClass.seated
                    ? Icons.event_seat_outlined
                    : Icons.groups_outlined,
                color: EsokoColors.text2,
                size: 18,
              ),
              const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ticketClass.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    if (ticketClass.amenities.isNotEmpty)
                      Text(
                        ticketClass.amenities.join(' · '),
                        style: TextStyle(
                          fontSize: 11,
                          color: EsokoColors.text3,
                        ),
                      ),
                  ],
                ),
              ),
              Text(
                'KES ${ticketClass.priceKes}',
                style: TextStyle(
                  color: EsokoColors.green,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SeatButton extends StatelessWidget {
  const _SeatButton({
    required this.seat,
    required this.selected,
    required this.onTap,
  });
  final SeatRow seat;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final taken = seat.status != 'AVAILABLE';
    // Available seats sit on the scheme surface, never a hardcoded
    // white — the seat map stays legible in dark mode.
    final Color bg = taken
        ? EsokoColors.line
        : (selected ? EsokoColors.green : Theme.of(context).colorScheme.surface);
    final Color fg = taken
        ? EsokoColors.text3
        : (selected ? Colors.white : EsokoColors.text2);
    return SizedBox(
      width: 36,
      height: 36,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(EsokoRadius.sm),
        child: InkWell(
          onTap: taken ? null : onTap,
          borderRadius: BorderRadius.circular(EsokoRadius.sm),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EsokoRadius.sm),
              border: Border.all(
                color: selected ? EsokoColors.green : EsokoColors.line,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.event_seat, size: 14, color: fg),
                Text(
                  seat.label,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
