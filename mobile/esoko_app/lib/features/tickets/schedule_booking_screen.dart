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
            const CircularProgressIndicator(),
            const SizedBox(height: EsokoSpacing.s4),
            const Text('Check your phone and enter your M-Pesa PIN to complete payment.', textAlign: TextAlign.center),
            if (_totalKes != null) ...[
              const SizedBox(height: EsokoSpacing.s2),
              Text('KES $_totalKes', style: TextStyle(color: EsokoColors.green, fontWeight: FontWeight.bold)),
            ],
          ],
        );
      case _Stage.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, color: EsokoColors.green, size: 56),
            const SizedBox(height: EsokoSpacing.s3),
            Text('Booking confirmed', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: EsokoSpacing.s2),
            const Text('Find your ticket QR any time under Tickets → My tickets.', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s5),
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
            Icon(Icons.error_outline, color: EsokoColors.red, size: 48),
            const SizedBox(height: EsokoSpacing.s3),
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center),
            const SizedBox(height: EsokoSpacing.s4),
            OutlinedButton(onPressed: () => setState(() => _stage = _Stage.pick), child: const Text('Start over')),
          ],
        );
    }
  }

  Widget _pickStage() {
    final tc = _selectedClass;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Choose a ticket type', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: EsokoSpacing.s3),
        for (final c in widget.ticketClasses)
          RadioListTile<String>(
            value: c.id,
            groupValue: tc?.id,
            title: Text('${c.name} — KES ${c.priceKes}'),
            subtitle: c.amenities.isNotEmpty ? Text(c.amenities.join(', ')) : null,
            onChanged: (_) => setState(() {
              _selectedClass = c;
              _selectedSeatId = null;
            }),
          ),
        if (tc != null && tc.seated) ...[
          const SizedBox(height: EsokoSpacing.s3),
          Text('Choose a seat', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: EsokoSpacing.s2),
          _seatPicker(tc.id),
        ] else if (tc != null) ...[
          const SizedBox(height: EsokoSpacing.s3),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null, icon: const Icon(Icons.remove_circle_outline)),
              Text('$_quantity', style: Theme.of(context).textTheme.titleMedium),
              IconButton(onPressed: () => setState(() => _quantity++), icon: const Icon(Icons.add_circle_outline)),
            ],
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
        return Wrap(
          spacing: EsokoSpacing.s2,
          runSpacing: EsokoSpacing.s2,
          children: [
            for (final seat in forClass)
              ChoiceChip(
                label: Text(seat.label),
                selected: _selectedSeatId == seat.id,
                onSelected: seat.status == 'AVAILABLE' ? (_) => setState(() => _selectedSeatId = seat.id) : null,
                disabledColor: EsokoColors.line,
                labelStyle: TextStyle(color: seat.status == 'AVAILABLE' ? null : EsokoColors.text3),
              ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Text('Could not load seats.', style: TextStyle(color: EsokoColors.red)),
    );
  }

  Widget _detailsStage() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Your name')),
        const SizedBox(height: EsokoSpacing.s3),
        TextField(
          controller: _msisdnController,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'M-Pesa phone number', hintText: '+254 7…'),
        ),
        const SizedBox(height: EsokoSpacing.s5),
        FilledButton(onPressed: _book, child: const Text('Pay with M-Pesa')),
      ],
    );
  }
}
