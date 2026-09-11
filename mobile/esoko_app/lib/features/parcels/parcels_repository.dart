import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import 'parcel_models.dart';

/// The parcels feature slice of the Riverpod convention (see
/// ARCHITECTURE.md) — a physical object's custody chain, no payment
/// involved (see the Parcel model's own schema comment).
final parcelsRepositoryProvider = Provider<ParcelsRepository>((ref) {
  return ParcelsRepository(ref.watch(apiClientProvider));
});

class BookedParcel {
  const BookedParcel({
    required this.parcelId,
    required this.code,
    required this.status,
  });
  final String parcelId;
  final String code;
  final String status;
}

class ParcelPaymentResult {
  const ParcelPaymentResult({
    required this.status,
    this.checkoutRequestId,
  });
  final String status; // BOOKED | DRAFT_PENDING_PAYMENT
  final String? checkoutRequestId;
}

class ParcelsRepository {
  ParcelsRepository(this._api);

  final ApiClient _api;

  /// POST /v1/parcels — guest-or-authenticated, mirrors
  /// StoresRepository.placeOrder's shape. Starts as
  /// DRAFT_PENDING_PAYMENT — getPricing/setPrice/pay are what turn it
  /// into a real, BOOKED parcel.
  Future<BookedParcel> bookParcel({
    required String senderName,
    required String senderMsisdn,
    required String receiverName,
    required String receiverMsisdn,
    required String originLabel,
    required String destinationLabel,
    required String parcelType,
    double? weightKg,
    bool fragile = false,
    String? notes,
    String? originZoneId,
    String? destinationZoneId,
  }) async {
    final res = await _api.post('/v1/parcels', {
      'senderName': senderName,
      'senderMsisdn': senderMsisdn,
      'receiverName': receiverName,
      'receiverMsisdn': receiverMsisdn,
      'originLabel': originLabel,
      'destinationLabel': destinationLabel,
      'parcelType': parcelType,
      if (weightKg != null) 'weightKg': weightKg,
      'fragile': fragile,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      if (originZoneId != null) 'originZoneId': originZoneId,
      if (destinationZoneId != null) 'destinationZoneId': destinationZoneId,
    });
    return BookedParcel(
      parcelId: res['parcelId'] as String,
      code: res['code'] as String,
      status: res['status'] as String? ?? 'DRAFT_PENDING_PAYMENT',
    );
  }

  /// GET /v1/parcels/pricing?parcelType= — public, needed before the
  /// sender has even booked, let alone signed in. Passing both zone ids
  /// folds the distance surcharge into the returned band (and adds
  /// distanceKm) so the sender sees the real price before confirming —
  /// see dbx.DistanceSurchargeKes's own comment on the degradation path
  /// when either is omitted.
  Future<ParcelPricing> getPricing(
    String parcelType, {
    String? originZoneId,
    String? destinationZoneId,
  }) async {
    var path = '/v1/parcels/pricing?parcelType=${Uri.encodeComponent(parcelType)}';
    if (originZoneId != null && destinationZoneId != null) {
      path += '&originZoneId=${Uri.encodeComponent(originZoneId)}'
          '&destinationZoneId=${Uri.encodeComponent(destinationZoneId)}';
    }
    final res = await _api.get(path);
    return ParcelPricing.fromJson(res);
  }

  /// GET /v1/parcels/pricing (no parcelType) — every type's pricing at
  /// once, lightest first. The booking form uses this to show each
  /// dropdown option's own weight/price range and to match an entered
  /// weight to a bracket without a round trip per keystroke.
  Future<List<ParcelPricing>> getAllPricing() async {
    final res = await _api.get('/v1/parcels/pricing');
    final list = (res['pricing'] as List?) ?? const [];
    return list
        .map((e) => ParcelPricing.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/parcels/zones — public, active zones only, the booking
  /// form's zone picker.
  Future<List<ParcelZone>> listZones() async {
    final res = await _api.get('/v1/parcels/zones');
    final list = (res['zones'] as List?) ?? const [];
    return list.map((e) => ParcelZone.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /v1/parcels/:code/price — the chosen price is only a UI
  /// convenience; the server re-derives and enforces the actual
  /// allowed range/reason itself.
  Future<void> setPrice({
    required String code,
    required double priceKes,
    String? bargainReason,
  }) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/price', {
      'priceKes': priceKes,
      if (bargainReason != null) 'bargainReason': bargainReason,
    });
  }

  /// POST /v1/parcels/:code/pay — ESOKO_POINTS settles inline;
  /// MPESA_STK starts a push the caller then polls [status] for.
  Future<ParcelPaymentResult> pay({
    required String code,
    required String paymentMethod,
    String? msisdn,
  }) async {
    final res = await _api.post('/v1/parcels/${Uri.encodeComponent(code)}/pay', {
      'paymentMethod': paymentMethod,
      if (msisdn != null) 'msisdn': msisdn,
    });
    return ParcelPaymentResult(
      status: res['status'] as String,
      checkoutRequestId: res['checkoutRequestId'] as String?,
    );
  }

  /// GET /v1/parcels/:code/status — guest-safe.
  Future<ParcelStatusView?> status(String code) async {
    try {
      final res = await _api.get(
        '/v1/parcels/${Uri.encodeComponent(code)}/status',
      );
      return ParcelStatusView.fromJson(res);
    } on ApiException catch (e) {
      if (e.code == 'NOT_FOUND') return null;
      rethrow;
    }
  }

  /// POST /v1/parcels/:code/handoff — a driver/handler scanning a
  /// parcel into their own custody.
  Future<String> scanHandoff(String code) async {
    final res = await _api.post(
      '/v1/parcels/${Uri.encodeComponent(code)}/handoff',
    );
    return res['status'] as String;
  }

  /// POST /v1/parcels/:code/deliver — the terminal handoff, proved by
  /// the deliveryCode only the sender was shown.
  Future<void> deliver({required String code, required String deliveryCode}) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/deliver', {
      'deliveryCode': deliveryCode,
    });
  }

  /// GET /v1/me/parcels — everything this party has sent.
  Future<List<ParcelRow>> myParcels() async {
    final res = await _api.get('/v1/me/parcels');
    final list = (res['parcels'] as List?) ?? const [];
    return list.map((e) => ParcelRow.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// GET /v1/me/parcels/holding — everything currently in this party's
  /// custody, not yet delivered.
  Future<List<ParcelRow>> heldParcels() async {
    final res = await _api.get('/v1/me/parcels/holding');
    final list = (res['parcels'] as List?) ?? const [];
    return list.map((e) => ParcelRow.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /v1/parcels/:code/receipt/otp — public, sends a code to the
  /// receiver number already on the parcel (never one typed here).
  /// Returns a masked form of that number for display.
  Future<String> requestReceiptOtp(String code) async {
    final res = await _api.post(
      '/v1/parcels/${Uri.encodeComponent(code)}/receipt/otp',
    );
    return res['maskedMsisdn'] as String;
  }

  /// POST /v1/parcels/:code/receipt/confirm — public, OTP-verified
  /// receiver confirmation plus a 1-5 condition rating.
  Future<void> confirmReceipt({
    required String code,
    required String otpCode,
    required int conditionRating,
    String? feedback,
  }) {
    return _api.post(
      '/v1/parcels/${Uri.encodeComponent(code)}/receipt/confirm',
      {
        'code': otpCode,
        'conditionRating': conditionRating,
        if (feedback != null && feedback.isNotEmpty) 'feedback': feedback,
      },
    );
  }

  /// POST /v1/parcel-couriers/me/pings — a courier's own location,
  /// posted only while the "Nearby jobs" tab is open (see
  /// parcels_hub_screen.dart's ping loop).
  Future<void> postCourierPing({required double lat, required double lng}) {
    return _api.post('/v1/parcel-couriers/me/pings', {'lat': lat, 'lng': lng});
  }

  /// GET /v1/parcel-couriers/me/available-jobs — BOOKED, unassigned
  /// parcels ranked by distance from this courier's last posted ping.
  Future<List<AvailableJob>> listAvailableJobs({double radiusKm = 15}) async {
    final res = await _api.get(
      '/v1/parcel-couriers/me/available-jobs?radiusKm=$radiusKm',
    );
    final list = (res['jobs'] as List?) ?? const [];
    return list.map((e) => AvailableJob.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /v1/parcels/:code/claim — the real first-accept-wins dispatch
  /// primitive. Throws ApiException(code: 'ALREADY_DELIVERED') when a
  /// rival courier claimed it first — see dbx.ClaimParcel's own comment
  /// on why that's the shared "already gone" code, not a new one.
  Future<void> claimJob(String code) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/claim');
  }

  /// GET /v1/parcels/:code/handoffs — authenticated, scoped to the
  /// parcel's own sender. Returns null (rather than throwing) on a 403
  /// — a guest or the receiver viewing the same status screen simply
  /// doesn't get this section, not an error state.
  Future<List<ParcelHandoffRow>?> handoffHistory(String code) async {
    try {
      final res = await _api.get(
        '/v1/parcels/${Uri.encodeComponent(code)}/handoffs',
      );
      final list = (res['handoffs'] as List?) ?? const [];
      return list
          .map((e) => ParcelHandoffRow.fromJson(e as Map<String, dynamic>))
          .toList();
    } on ApiException catch (e) {
      if (e.code == 'FORBIDDEN' ||
          e.code == 'UNAUTHENTICATED' ||
          e.code == 'SESSION_EXPIRED') {
        return null;
      }
      rethrow;
    }
  }
}
