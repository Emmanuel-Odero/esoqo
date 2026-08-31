import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_state.dart';
import '../../core/theme/esoko_tokens.dart';
import 'ticketing_models.dart';

final scheduleSeatsProvider = FutureProvider.autoDispose.family<List<SeatRow>, String>((ref, scheduleId) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.get('/v1/schedules/$scheduleId/seats');
  final list = (res['seats'] as List?) ?? const [];
  return list.map((e) => SeatRow.fromJson(e as Map<String, dynamic>)).toList();
});

enum _Stage { pick, details, waiting, done, failed }

/// Picks a ticket class (+ seat, if seated) for one schedule, then books
/// and pays — POST /v1/bookings → M-Pesa STK → poll GET /v1/bookings/:id.
class ScheduleBookingScreen extends ConsumerStatefulWidget {
  const ScheduleBookingScreen({super.key, required this.scheduleId, required this.ticketClasses, required this.listingTitle});
  final String scheduleId;
  final List<TicketClass> ticketClasses;
  final String listingTitle;

  @override
  ConsumerState<ScheduleBookingScreen> createState() => _ScheduleBookingScreenState();
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

  @override
  void initState() {
    super.initState();
    _selectedClass = widget.ticketClasses.isNotEmpty ? widget.ticketClasses.first : null;
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
      final api = ref.read(apiClientProvider);
      final res = await api.post('/v1/bookings', {
        'scheduleId': widget.scheduleId,
        'buyerName': _nameController.text.trim(),
        'buyerMsisdn': _msisdnController.text.trim(),
        'lines': [
          {
            'ticketClassId': tc.id,
            if (_selectedSeatId != null) 'seatId': _selectedSeatId,
            'quantity': tc.seated ? 1 : _quantity,
          },
        ],
      });
      _bookingId = res['bookingId'] as String?;
      _totalKes = res['totalKes'] as String?;
      if (res['status'] == 'PAID') {
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
        return;
      }
      try {
        final api = ref.read(apiClientProvider);
        final res = await api.get('/v1/bookings/$_bookingId');
        final booking = res['booking'] as Map<String, dynamic>?;
        if (booking?['Status'] == 'PAID') {
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
    return Scaffold(
      appBar: AppBar(title: Text(widget.listingTitle)),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(padding: const EdgeInsets.all(EsokoSpacing.s5), child: _body()),
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
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _statusBadge(icon: Icons.phone_android_rounded, color: EsokoColors.blue, spinning: true),
            const SizedBox(height: EsokoSpacing.s5),
            Text('Complete payment on your phone', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s2),
            Text('Enter your M-Pesa PIN when the prompt arrives.', style: TextStyle(color: EsokoColors.text2), textAlign: TextAlign.center),
            if (_totalKes != null) ...[
              const SizedBox(height: EsokoSpacing.s4),
              Text('KES $_totalKes', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ],
        );
      case _Stage.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _statusBadge(icon: Icons.check_rounded, color: EsokoColors.green),
            const SizedBox(height: EsokoSpacing.s4),
            Text('Booking confirmed', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: EsokoSpacing.s2),
            Text('Find your ticket QR any time under Tickets → My tickets.', textAlign: TextAlign.center, style: TextStyle(color: EsokoColors.text2)),
            const SizedBox(height: EsokoSpacing.s6),
            FilledButton(
              onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
              child: const Text('Done'),
            ),
          ],
        );
      case _Stage.failed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _statusBadge(icon: Icons.priority_high_rounded, color: EsokoColors.red),
            const SizedBox(height: EsokoSpacing.s4),
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s5),
            OutlinedButton(onPressed: () => setState(() => _stage = _Stage.pick), child: const Text('Start over')),
          ],
        );
    }
  }

  Widget _statusBadge({required IconData icon, required Color color, bool spinning = false}) {
    return SizedBox(
      width: 88,
      height: 88,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (spinning) const SizedBox(width: 88, height: 88, child: CircularProgressIndicator(strokeWidth: 3)),
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 32),
          ),
        ],
      ),
    );
  }

  Widget _pickStage() {
    final tc = _selectedClass;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Choose a ticket type', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: EsokoSpacing.s3),
        for (final c in widget.ticketClasses)
          _TicketClassOption(
            ticketClass: c,
            selected: tc?.id == c.id,
            onTap: () => setState(() {
              _selectedClass = c;
              _selectedSeatId = null;
            }),
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
            child: Container(
              decoration: BoxDecoration(border: Border.all(color: EsokoColors.line), borderRadius: BorderRadius.circular(EsokoRadius.pill)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null, icon: const Icon(Icons.remove)),
                  SizedBox(width: 28, child: Text('$_quantity', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
                  IconButton(onPressed: () => setState(() => _quantity++), icon: const Icon(Icons.add)),
                ],
              ),
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
    final seats = ref.watch(scheduleSeatsProvider(widget.scheduleId));
    return seats.when(
      data: (all) {
        final forClass = all.where((s) => s.ticketClassId == ticketClassId).toList();
        if (forClass.isEmpty) return Text('No seats configured for this class.', style: TextStyle(color: EsokoColors.text2));
        return Column(
          children: [
            Container(
              padding: const EdgeInsets.all(EsokoSpacing.s4),
              decoration: BoxDecoration(color: EsokoColors.paper, borderRadius: BorderRadius.circular(EsokoRadius.lg)),
              child: Column(
                children: [
                  Icon(Icons.airline_seat_recline_normal, color: EsokoColors.text3, size: 22),
                  const SizedBox(height: EsokoSpacing.s1),
                  Text('FRONT', style: TextStyle(fontSize: 10, letterSpacing: 2, color: EsokoColors.text3)),
                  const SizedBox(height: EsokoSpacing.s3),
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 4,
                    mainAxisSpacing: EsokoSpacing.s2,
                    crossAxisSpacing: EsokoSpacing.s2,
                    childAspectRatio: 1,
                    children: [for (final seat in forClass) _SeatButton(seat: seat, selected: _selectedSeatId == seat.id, onTap: () => setState(() => _selectedSeatId = seat.id))],
                  ),
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
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Text('Could not load seats.', style: TextStyle(color: EsokoColors.red)),
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
            border: outline ? Border.all(color: EsokoColors.line, width: 1.5) : null,
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
        TextField(
          controller: _nameController,
          decoration: const InputDecoration(labelText: 'Your name', prefixIcon: Icon(Icons.person_outline)),
        ),
        const SizedBox(height: EsokoSpacing.s3),
        TextField(
          controller: _msisdnController,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: 'M-Pesa phone number',
            hintText: '+254 7…',
            prefixIcon: Icon(Icons.phone_iphone_outlined),
          ),
        ),
        const SizedBox(height: EsokoSpacing.s5),
        FilledButton.icon(
          onPressed: _book,
          icon: const Icon(Icons.lock_outline, size: 18),
          label: const Text('Pay with M-Pesa'),
        ),
      ],
    );
  }
}

class _TicketClassOption extends StatelessWidget {
  const _TicketClassOption({required this.ticketClass, required this.selected, required this.onTap});
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
          decoration: BoxDecoration(border: Border.all(color: selected ? EsokoColors.green : EsokoColors.line, width: selected ? 1.5 : 1)),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? EsokoColors.green : EsokoColors.text3,
                size: 22,
              ),
              const SizedBox(width: EsokoSpacing.s3),
              Icon(ticketClass.seated ? Icons.event_seat_outlined : Icons.groups_outlined, color: EsokoColors.text2, size: 18),
              const SizedBox(width: EsokoSpacing.s2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(ticketClass.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                    if (ticketClass.amenities.isNotEmpty)
                      Text(ticketClass.amenities.join(' · '), style: TextStyle(fontSize: 11, color: EsokoColors.text3)),
                  ],
                ),
              ),
              Text('KES ${ticketClass.priceKes}', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SeatButton extends StatelessWidget {
  const _SeatButton({required this.seat, required this.selected, required this.onTap});
  final SeatRow seat;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final taken = seat.status != 'AVAILABLE';
    final Color bg = taken ? EsokoColors.line : (selected ? EsokoColors.green : Colors.white);
    final Color fg = taken ? EsokoColors.text3 : (selected ? Colors.white : EsokoColors.text2);
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(EsokoRadius.sm),
      child: InkWell(
        onTap: taken ? null : onTap,
        borderRadius: BorderRadius.circular(EsokoRadius.sm),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(EsokoRadius.sm),
            border: Border.all(color: selected ? EsokoColors.green : EsokoColors.line),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.event_seat, size: 16, color: fg),
              Text(seat.label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: fg)),
            ],
          ),
        ),
      ),
    );
  }
}
