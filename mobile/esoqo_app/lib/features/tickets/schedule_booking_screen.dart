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
import 'widgets/seat_button.dart';
import 'widgets/ticket_class_option.dart';

final scheduleSeatsProvider = FutureProvider.autoDispose
    .family<SeatMapResult, String>(
      (ref, scheduleId) =>
          ref.watch(ticketingRepositoryProvider).seats(scheduleId),
    );

enum _Stage { pick, details, waiting, done, depositDone, failed }

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
  final _depositController = TextEditingController();
  String _method = 'MPESA_STK';

  /// Lipa pole pole — a deposit now, the rest before departure. Only
  /// ever offered for a non-seated (GA) class; the server enforces the
  /// same rule (dbx.OpenInstallmentPlan) and everything else about
  /// eligibility (org opt-in, 48h+ lead time, minimum deposit) — this
  /// flag only decides which endpoint _book() calls, never whether the
  /// plan is actually allowed.
  bool _payInInstallments = false;

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
    _depositController.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    final tc = _selectedClass;
    if (tc == null) return;
    if (_payInInstallments) {
      await _openInstallmentPlan(tc);
      return;
    }
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
      _startPolling(untilPaid: true);
    } on ApiException catch (e) {
      setState(() {
        _stage = _Stage.failed;
        _error = e.message;
      });
    }
  }

  Future<void> _openInstallmentPlan(TicketClass tc) async {
    final deposit = double.tryParse(_depositController.text.trim());
    if (deposit == null || deposit <= 0) {
      setState(() => _error = 'Enter how much you\'re paying today.');
      return;
    }
    setState(() {
      _stage = _Stage.waiting;
      _error = null;
    });
    try {
      final repo = ref.read(ticketingRepositoryProvider);
      final placed = await repo.openInstallmentPlan(
        scheduleId: widget.scheduleId,
        ticketClassId: tc.id,
        quantity: _quantity,
        buyerName: _nameController.text.trim(),
        buyerMsisdn: _msisdnController.text.trim(),
        depositKes: deposit,
      );
      _bookingId = placed.bookingId;
      _totalKes = placed.totalKes;
      if (placed.paymentError != null) {
        setState(() {
          _stage = _Stage.failed;
          _error = placed.paymentError;
        });
        return;
      }
      if (placed.status != 'PENDING_PAYMENT') {
        // Console/dev mode auto-confirms the deposit inline — no need
        // to poll for what the response already tells us happened.
        setState(() => _stage = _Stage.depositDone);
        return;
      }
      _startPolling(untilPaid: false);
    } on ApiException catch (e) {
      setState(() {
        _stage = _Stage.failed;
        _error = e.message;
      });
    }
  }

  /// untilPaid selects which "done" a confirmed payment means: a
  /// regular booking is done once status flips to PAID; a deposit is
  /// done once it clears at all (status leaves PENDING_PAYMENT) — the
  /// plan itself stays PARTIALLY_PAID until the balance is fully paid
  /// off, which is expected, not a failure to keep polling for.
  void _startPolling({required bool untilPaid}) {
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
            _error = 'We could not confirm your M-Pesa payment. If you were charged, it will appear in Your tickets — otherwise try again.';
          });
        }
        return;
      }
      try {
        final repo = ref.read(ticketingRepositoryProvider);
        if (untilPaid) {
          if (await repo.isBookingPaid(_bookingId!)) {
            timer.cancel();
            if (mounted) setState(() => _stage = _Stage.done);
          }
        } else {
          final status = await repo.bookingStatus(_bookingId!);
          if (status.status != 'PENDING_PAYMENT') {
            timer.cancel();
            if (mounted) setState(() => _stage = _Stage.depositDone);
          }
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
                child: KeyedSubtree(key: ValueKey(_stage), child: _body()),
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
          message: 'Find your ticket QR any time under Tickets → Your tickets.',
          primaryLabel: 'Done',
          onPrimary: () => Navigator.of(context).popUntil((r) => r.isFirst),
        );
      case _Stage.depositDone:
        return EsokoResultView.success(
          title: 'Deposit received',
          message:
              'Your seat isn\'t issued yet — pay the rest any time before departure under Tickets → Your tickets, and your ticket QR appears the moment the balance clears.',
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
          TicketClassOption(
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
        EsokoButton.primary(
          label: 'Continue',
          expand: false,
          onPressed: tc == null || (tc.seated && _selectedSeatId == null)
              ? null
              : () => setState(() => _stage = _Stage.details),
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
            style: TextStyle(
              color: Theme.of(context).textTheme.bodySmall?.color,
            ),
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
                // Theme's own surface tone, not the fixed EsokoColors.
                // paper — that pastel stayed light-mode-white even in
                // dark mode, sticking out as a bright panel.
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
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
                          color: Theme.of(context).textTheme.bodySmall?.color,
                          size: 18,
                        ),
                        Text(
                          'FRONT',
                          style: TextStyle(
                            fontSize: 9,
                            letterSpacing: 2,
                            color: Theme.of(context).textTheme.bodySmall?.color,
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
                              color: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.color,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                        const SizedBox(width: EsokoSpacing.s2),
                        for (final seat in byRow[r]!) ...[
                          SeatButton(
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
                _seatLegend(
                  Theme.of(context).colorScheme.surfaceContainerHighest,
                  'Available',
                  outline: true,
                ),
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
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: Theme.of(context).textTheme.bodySmall?.color,
          ),
        ),
      ],
    );
  }

  Widget _detailsStage() {
    // Lipa pole pole is only ever offered for a GA (non-seated) class —
    // matches dbx.OpenInstallmentPlan's own restriction exactly, so the
    // toggle never promises something the server would then refuse.
    final canInstallment = _selectedClass?.seated == false;
    final total = _selectedClass == null
        ? 0.0
        : (double.tryParse(_selectedClass!.priceKes) ?? 0) * _quantity;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (canInstallment) ...[
          EsokoSegmentedToggle<bool>(
            selected: _payInInstallments,
            onChanged: (v) => setState(() => _payInInstallments = v),
            options: const [
              (false, 'Pay in full'),
              (true, 'Pay a deposit'),
            ],
          ),
          const SizedBox(height: 12),
        ],
        if (_payInInstallments) ...[
          Text(
            'Total KES ${total.toStringAsFixed(0)} — pay what you can today, the rest any time before departure.',
            style: TextStyle(
              fontSize: 12.5,
              color: Theme.of(context).textTheme.bodySmall?.color,
            ),
          ),
          const SizedBox(height: 12),
          EsokoField.amount(
            controller: _depositController,
            label: 'Paying today',
          ),
        ] else ...[
          EsokoSegmentedToggle<String>(
            selected: _method,
            onChanged: (m) => setState(() => _method = m),
            options: const [('MPESA_STK', 'M-Pesa'), ('VOUCHER', 'Voucher')],
          ),
          if (_method == 'VOUCHER') ...[
            const SizedBox(height: 12),
            EsokoField.code(
              controller: _voucherCodeController,
              label: 'Voucher code',
              hint: 'e.g. VCH-XXXXXX',
            ),
          ],
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          EsokoFormError(message: _error!),
        ],
        const SizedBox(height: 12),
        EsokoPayerFields(
          nameController: _nameController,
          msisdnController: _msisdnController,
          payLabel: _payInInstallments
              ? 'Pay deposit'
              : (_method == 'VOUCHER' ? 'Pay with voucher' : 'Pay with M-Pesa'),
          onPay: _book,
        ),
      ],
    );
  }
}
