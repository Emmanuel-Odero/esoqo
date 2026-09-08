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
  const BookedParcel({required this.parcelId, required this.code});
  final String parcelId;
  final String code;
}

class ParcelsRepository {
  ParcelsRepository(this._api);

  final ApiClient _api;

  /// POST /v1/parcels — guest-or-authenticated, mirrors
  /// StoresRepository.placeOrder's shape.
  Future<BookedParcel> bookParcel({
    required String senderName,
    required String senderMsisdn,
    required String receiverName,
    required String receiverMsisdn,
    required String originLabel,
    required String destinationLabel,
    String? notes,
  }) async {
    final res = await _api.post('/v1/parcels', {
      'senderName': senderName,
      'senderMsisdn': senderMsisdn,
      'receiverName': receiverName,
      'receiverMsisdn': receiverMsisdn,
      'originLabel': originLabel,
      'destinationLabel': destinationLabel,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    return BookedParcel(
      parcelId: res['parcelId'] as String,
      code: res['code'] as String,
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
}
