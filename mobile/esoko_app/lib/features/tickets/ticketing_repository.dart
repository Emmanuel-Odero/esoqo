import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'ticketing_models.dart';

/// Tickets' slice of the Riverpod convention (see ARCHITECTURE.md and
/// `lib/features/shopping/stores_repository.dart`, the exemplar):
/// screens watch thin providers, this class owns every endpoint +
/// mapping. The booking write path mirrors checkout's `placeOrder` —
/// the screen keeps its `_Stage` machine and STK poll loop, the
/// repository shapes payloads and answers.
final ticketingRepositoryProvider = Provider<TicketingRepository>((ref) {
  return TicketingRepository(ref.watch(apiClientProvider));
});

class TicketingRepository {
  TicketingRepository(this._api);

  final ApiClient _api;

  /// GET /v1/listings — events + transport.
  Future<List<ListingSummary>> listings() async {
    final res = await _api.get('/v1/listings');
    final list = (res['listings'] as List?) ?? const [];
    return list
        .map((e) => ListingSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/listings/:id — detail with ticket classes + schedules.
  Future<ListingDetail> listing(String id) async {
    final res = await _api.get('/v1/listings/$id');
    return ListingDetail.fromJson(res);
  }

  /// GET /v1/schedules/:id/seats — the seat map for one departure.
  Future<SeatMapResult> seats(String scheduleId) async {
    final res = await _api.get('/v1/schedules/$scheduleId/seats');
    return SeatMapResult.fromJson(res);
  }

  /// GET /v1/me/tickets — every ticket issued to the signed-in person.
  Future<List<TicketRow>> myTickets() async {
    final res = await _api.get('/v1/me/tickets');
    final list = (res['tickets'] as List?) ?? const [];
    return list
        .map((e) => TicketRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Resolve a human voucher code (VCH-XXXXXX) to its card id, or null.
  /// Same endpoint shopping uses; owned here too so features never
  /// import each other's repositories.
  Future<String?> resolveVoucherCode(String code) async {
    final r = await _api.get(
      '/v1/vouchers/resolve?code=${Uri.encodeComponent(code.trim())}',
    );
    final id = (r['voucher'] as Map<String, dynamic>?)?['id'] as String?;
    return (id == null || id.isEmpty) ? null : id;
  }

  /// POST /v1/bookings — one schedule, one ticket class (+ seat when
  /// seated, quantity otherwise).
  Future<PlacedBooking> placeBooking({
    required String scheduleId,
    required String ticketClassId,
    String? seatId,
    required int quantity,
    required String buyerName,
    required String buyerMsisdn,
    required String paymentMethod,
    String? voucherId,
  }) async {
    final res = await _api.post('/v1/bookings', {
      'scheduleId': scheduleId,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
      'paymentMethod': paymentMethod,
      if (voucherId case var id) 'voucherId': id,
      'lines': [
        {
          'ticketClassId': ticketClassId,
          if (seatId case var sid) 'seatId': sid,
          'quantity': quantity,
        },
      ],
    });
    return PlacedBooking(
      bookingId: res['bookingId'] as String?,
      totalKes: res['totalKes'] as String?,
      paid: (res['status'] as String?) == 'PAID',
    );
  }

  /// True once the booking has flipped to PAID — the poll loop calls
  /// this, not the screen.
  Future<bool> isBookingPaid(String bookingId) async {
    final res = await _api.get('/v1/bookings/$bookingId');
    final booking = res['booking'] as Map<String, dynamic>?;
    return booking?['Status'] == 'PAID';
  }

  /// POST /v1/bookings/installment — "lipa pole pole": one line per
  /// ticket (GA classes only, checked server-side), a deposit now, the
  /// rest before the trip. Claims no seat/GA slot yet — nothing is
  /// reserved or issued until the balance clears (see
  /// dbx.OpenInstallmentPlan).
  Future<PlacedInstallment> openInstallmentPlan({
    required String scheduleId,
    required String ticketClassId,
    required int quantity,
    required String buyerName,
    required String buyerMsisdn,
    required double depositKes,
  }) async {
    final res = await _api.post('/v1/bookings/installment', {
      'scheduleId': scheduleId,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
      'depositKes': depositKes,
      'lines': [
        for (var i = 0; i < quantity; i++) {'ticketClassId': ticketClassId},
      ],
    });
    return PlacedInstallment(
      bookingId: res['bookingId'] as String?,
      status: res['status'] as String? ?? 'PENDING_PAYMENT',
      totalKes: res['totalKes']?.toString(),
      balanceKes: res['balanceKes']?.toString(),
      checkoutRequestId: res['checkoutRequestId'] as String?,
      paymentError: res['paymentError'] as String?,
    );
  }

  /// POST /v1/bookings/:id/balance — a top-up against an open plan.
  /// Once this clears the balance in full, core-go issues the tickets
  /// (capacity-checked at that moment, not when the plan was opened).
  Future<PlacedInstallment> payInstallmentBalance({
    required String bookingId,
    required double amountKes,
  }) async {
    final res = await _api.post('/v1/bookings/$bookingId/balance', {
      'amountKes': amountKes,
    });
    return PlacedInstallment(
      bookingId: bookingId,
      status: res['status'] as String? ?? 'PARTIALLY_PAID',
      balanceKes: res['balanceKes']?.toString(),
      checkoutRequestId: res['checkoutRequestId'] as String?,
      paymentError: res['paymentError'] as String?,
    );
  }

  /// GET /v1/bookings/:id/status — polled after opening a plan (until
  /// the deposit clears) and after each top-up (until it clears).
  Future<BookingStatusView> bookingStatus(String bookingId) async {
    final res = await _api.get('/v1/bookings/$bookingId/status');
    return BookingStatusView.fromJson(
      (res['status'] as Map<String, dynamic>?) ?? const {},
    );
  }

  /// GET /v1/me/bookings — every booking ever placed, richer than
  /// myTickets() because an open installment plan has no tickets
  /// issued yet. What "My tickets" reads to show payment plans in
  /// progress, not just issued tickets.
  Future<List<MyBookingRich>> myBookings() async {
    final res = await _api.get('/v1/me/bookings');
    final list = (res['bookings'] as List?) ?? const [];
    return list
        .map((e) => MyBookingRich.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

/// The shaped answer to POST /v1/bookings the booking stage machine acts on.
class PlacedBooking {
  const PlacedBooking({this.bookingId, this.totalKes, required this.paid});

  final String? bookingId;
  final String? totalKes;
  final bool paid;
}
