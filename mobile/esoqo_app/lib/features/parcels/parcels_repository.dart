import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/api/providers.dart';
import '../../core/money/money.dart';
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
    // A code already printed and stuck on the physical parcel ahead of
    // time (see dbx.ParcelLabelStock) — scanned or typed in at booking
    // instead of letting the server mint a fresh one.
    String? existingCode,
    // The pickup point the receiver collects from instead of a doorstep
    // delivery — earns the rate card's agent-drop discount.
    String? destinationAgentId,
    // Declared contents value plus the cover bought against it. Both or
    // neither; the server validates the pair and freezes the fee.
    double? declaredValueKes,
    String? coverageTierId,
    // A dropped pin for either end. Addressing failure is this market's
    // largest cause of delivery failure; a pin is what a courier's maps
    // app can route to, where the free-text label is prose to read.
    double? originLat,
    double? originLng,
    double? destinationLat,
    double? destinationLng,
  }) async {
    final res = await _api.post('/v1/parcels', {
      'senderName': senderName,
      'senderMsisdn': senderMsisdn,
      'receiverName': receiverName,
      'receiverMsisdn': receiverMsisdn,
      'originLabel': originLabel,
      'destinationLabel': destinationLabel,
      'parcelType': parcelType,
      'weightKg': ?weightKg,
      'fragile': fragile,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      'originZoneId': ?originZoneId,
      'destinationZoneId': ?destinationZoneId,
      if (existingCode != null && existingCode.isNotEmpty) 'existingCode': existingCode,
      'destinationAgentId': ?destinationAgentId,
      'declaredValueKes': ?declaredValueKes,
      'coverageTierId': ?coverageTierId,
      'originLat': ?originLat,
      'originLng': ?originLng,
      'destinationLat': ?destinationLat,
      'destinationLng': ?destinationLng,
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
  /// This is a pure read and creates nothing — which is the point. The
  /// booking form used to POST a DRAFT_PENDING_PAYMENT parcel just to
  /// find out what one cost, which is where the admin console's
  /// stale-draft backlog came from. Every modifier goes to the server
  /// rather than being applied here, so the number shown to the sender
  /// is the number SetParcelPrice will independently re-derive and
  /// accept (see dbx.ParcelPriceBand).
  Future<ParcelPricing> getPricing(
    String parcelType, {
    String? originZoneId,
    String? destinationZoneId,
    String? destinationAgentId,
    double? declaredValueKes,
    String? coverageTierId,
    // A dropped pin for either end. Addressing failure is this market's
    // largest cause of delivery failure; a pin is what a courier's maps
    // app can route to, where the free-text label is prose to read.
    double? originLat,
    double? originLng,
    double? destinationLat,
    double? destinationLng,
  }) async {
    var path = '/v1/parcels/pricing?parcelType=${Uri.encodeComponent(parcelType)}';
    if (originZoneId != null && destinationZoneId != null) {
      path += '&originZoneId=${Uri.encodeComponent(originZoneId)}'
          '&destinationZoneId=${Uri.encodeComponent(destinationZoneId)}';
    }
    if (destinationAgentId != null) {
      path += '&destinationAgentId=${Uri.encodeComponent(destinationAgentId)}';
    }
    if (declaredValueKes != null && coverageTierId != null) {
      path += '&declaredValueKes=$declaredValueKes'
          '&coverageTierId=${Uri.encodeComponent(coverageTierId)}';
    }
    final res = await _api.get(path);
    return ParcelPricing.fromJson(res);
  }

  /// GET /v1/parcels/agents — public, active pickup points. With
  /// coordinates it returns the nearest shops that still have shelf
  /// space; without, the whole active list.
  Future<List<ParcelAgent>> listAgents({double? lat, double? lng}) async {
    var path = '/v1/parcels/agents';
    if (lat != null && lng != null) path += '?lat=$lat&lng=$lng';
    final res = await _api.get(path);
    final list = (res['agents'] as List?) ?? const [];
    return list.map((e) => ParcelAgent.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// GET /v1/parcels/coverage — cover levels, each already quoted
  /// against [declaredValueKes] by the server.
  Future<List<ParcelCoverageTier>> listCoverageTiers(double declaredValueKes) async {
    final res = await _api.get('/v1/parcels/coverage?declaredValueKes=$declaredValueKes');
    final list = (res['tiers'] as List?) ?? const [];
    return list
        .map((e) => ParcelCoverageTier.fromJson(e as Map<String, dynamic>))
        .toList();
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
    required Money priceKes,
    String? bargainReason,
  }) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/price', {
      // Exact decimal string; core-go's money.Amount binding takes
      // either shape, so older builds sending a number still work.
      'priceKes': priceKes.toWire(),
      'bargainReason': ?bargainReason,
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
      'msisdn': ?msisdn,
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

  /// GET /v1/parcels/:code/label — auth required. 403s (surfaced as
  /// ApiException with code DENIED) for anyone who isn't currently
  /// holding/assigned to the parcel or org staff with parcels.read.
  Future<ParcelLabel> label(String code) async {
    final res = await _api.get(
      '/v1/parcels/${Uri.encodeComponent(code)}/label',
    );
    return ParcelLabel.fromJson(res);
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
  /// the deliveryCode only the sender was shown, plus whatever proof
  /// the courier captured at the door.
  ///
  /// [photoKey] is what [uploadPodPhoto] returned — a storage key, never
  /// a URL this client composed. [receivedByName] is the single most
  /// useful field in a later dispute: whoever actually took the parcel
  /// is frequently not the receiver (a watchman, a shop attendant, a
  /// neighbour), and the code-only flow threw that away entirely.
  Future<void> deliver({
    required String code,
    required String deliveryCode,
    String? photoKey,
    double? lat,
    double? lng,
    String? receivedByName,
    // What the buyer paid at the door, for a cash-on-delivery parcel.
    // The server refuses to complete a COD delivery without it — handing
    // over goods with the money unrecorded is the exact failure COD has
    // to be built to prevent.
    Money? codCollectedKes,
  }) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/deliver', {
      'deliveryCode': deliveryCode,
      'photoKey': ?photoKey,
      'lat': ?lat,
      'lng': ?lng,
      if (receivedByName != null && receivedByName.isNotEmpty)
        'receivedByName': receivedByName,
      // An exact decimal string. core-go binds this through money.Amount
      // (handlers_parcels.go's deliverParcelRequest), which accepts a
      // string or a number — so this no longer has to round-trip a
      // courier's cash through a float on the way out. The number form
      // still works and is what older builds of this app send; see
      // step 3 of docs/proposals/money-representation.md.
      if (codCollectedKes != null)
        'codCollectedKes': codCollectedKes.toWire(),
    });
  }

  /// GET /v1/me/courier-earnings — a courier's own money: what they're
  /// owed, what they've been paid, and the rate behind both.
  Future<CourierEarningsView> courierEarnings() async {
    final res = await _api.get('/v1/me/courier-earnings');
    final list = (res['deliveries'] as List?) ?? const [];
    return CourierEarningsView(
      earnings: CourierEarnings.fromJson(
        (res['earnings'] as Map<String, dynamic>?) ?? const {},
      ),
      deliveries: list
          .map((e) => CourierEarningRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      tariff: CourierTariff.fromJson(
        (res['tariff'] as Map<String, dynamic>?) ?? const {},
      ),
    );
  }

  /// GET /v1/parcels/trips — buses a parcel could ride right now.
  Future<List<DepartingTrip>> listDepartingTrips({String q = ''}) async {
    final res = await _api.get('/v1/parcels/trips?q=${Uri.encodeComponent(q)}');
    final list = (res['trips'] as List?) ?? const [];
    return list.map((e) => DepartingTrip.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// GET /v1/parcels/trips/:tripId/stages — the stops on that bus's
  /// route, in travel order.
  Future<List<TripStage>> listTripStages(String tripId) async {
    final res = await _api.get('/v1/parcels/trips/${Uri.encodeComponent(tripId)}/stages');
    final list = (res['stages'] as List?) ?? const [];
    return list.map((e) => TripStage.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /v1/parcels/:code/board — a conductor loading a parcel they
  /// already hold onto the bus they are crewing. Boarding is not a
  /// custody transfer: the server checks custody AND crew separately.
  Future<void> boardOnTrip({
    required String code,
    required String tripId,
    String? dropStageId,
  }) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/board', {
      'tripId': tripId,
      'dropStageId': ?dropStageId,
    });
  }

  /// POST /v1/parcels/:code/drop — off at a stage. Custody stays with
  /// the conductor until it reaches a receiver or a pickup point.
  Future<void> dropFromTrip(String code) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/drop');
  }

  /// GET /v1/me/cod-holding — how much collected cash this rider is
  /// still carrying, which is what they reconcile against at the end of
  /// a round.
  Future<RiderCodHolding> codHolding() async {
    final res = await _api.get('/v1/me/cod-holding');
    return RiderCodHolding.fromJson(res);
  }

  /// POST /v1/parcels/:code/pod-photo — multipart. Returns the storage
  /// key to pass to [deliver]; the image itself is only ever readable
  /// back through the API's own authorised route.
  Future<String> uploadPodPhoto({
    required String code,
    required List<int> bytes,
    String filename = 'pod.jpg',
  }) async {
    final res = await _api.uploadImage(
      '/v1/parcels/${Uri.encodeComponent(code)}/pod-photo',
      field: 'photo',
      bytes: bytes,
      filename: filename,
    );
    return res['photoKey'] as String;
  }

  /// POST /v1/parcels/:code/attempt — "I got there and couldn't hand it
  /// over". Custody deliberately doesn't move: the courier still has
  /// the parcel. Returns the running attempt count, which is what
  /// decides whether the next step is another try or a return.
  Future<int> recordAttempt({
    required String code,
    required String reason,
    String? note,
    double? lat,
    double? lng,
  }) async {
    final res = await _api.post('/v1/parcels/${Uri.encodeComponent(code)}/attempt', {
      'reason': reason,
      if (note != null && note.isNotEmpty) 'note': note,
      'lat': ?lat,
      'lng': ?lng,
    });
    return (res['attempts'] as num?)?.toInt() ?? 0;
  }

  /// POST /v1/parcels/:code/hold-at-agent — dropping a parcel on a
  /// shop's shelf. The receiver gets an SMS with the shop's name,
  /// location and hours.
  Future<void> holdAtAgent({required String code, required String agentId}) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/hold-at-agent', {
      'agentId': agentId,
    });
  }

  /// POST /v1/parcels/:code/return — the give-up path. Terminal, and
  /// distinct from a cancellation: the journey happened and was billed,
  /// it just ended at the origin.
  Future<void> returnToSender({required String code, required String reason}) {
    return _api.post('/v1/parcels/${Uri.encodeComponent(code)}/return', {
      'reason': reason,
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
  /// posted while the "Holding" or "Nearby jobs" tab is open (see
  /// parcels_hub_screen.dart's ping loop). Holding matters as much as
  /// Nearby: the public tracking page reads this to show a parcel's
  /// live position, and a courier is only carrying a parcel while they
  /// are on Holding.
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
