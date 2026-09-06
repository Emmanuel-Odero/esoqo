import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';
import 'shopping_models.dart';

/// The exemplar for the app's Riverpod convention (see ARCHITECTURE.md):
/// screens watch tiny `FutureProvider`s, and those providers delegate to
/// a feature repository that owns the endpoint + JSON mapping. Nothing
/// in `presentation` (screens/widgets) touches [ApiClient] or raw maps
/// anymore, so parsing can move, caching can land, and payloads can be
/// reshaped here without touching a single widget.
///
/// Other features adopt this file's shape during their own polish pass —
/// one repository per feature, same three sections (provider, class,
/// methods), no cross-feature imports.
final storesRepositoryProvider = Provider<StoresRepository>((ref) {
  return StoresRepository(ref.watch(apiClientProvider));
});

class StoresRepository {
  StoresRepository(this._api);

  final ApiClient _api;

  /// GET /v1/stores — the plain directory.
  Future<List<StoreSummary>> directory() async {
    final res = await _api.get('/v1/stores');
    final list = (res['stores'] as List?) ?? const [];
    return list
        .map((e) => StoreSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/stores/nearby — GPS-sorted "near me" when lat/lng are set,
  /// neighbourhood-text search on q. Either/both may be absent.
  Future<List<NearbyStore>> nearby({
    double? lat,
    double? lng,
    String q = '',
  }) async {
    final params = <String, String>{
      if (lat != null) 'lat': lat.toStringAsFixed(6),
      if (lng != null) 'lng': lng.toStringAsFixed(6),
      if (q.isNotEmpty) 'q': q,
    };
    final qs = params.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    final res = await _api.get('/v1/stores/nearby${qs.isEmpty ? '' : '?$qs'}');
    final list = (res['stores'] as List?) ?? const [];
    return list
        .map((e) => NearbyStore.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/stores/:slug — one store's header + fulfilment flags.
  Future<StoreDetail> detail(String slug) async {
    final res = await _api.get('/v1/stores/$slug');
    return StoreDetail.fromJson(res);
  }

  /// GET /v1/stores/:slug/products — the store's catalogue.
  Future<List<ProductSummary>> products(String slug) async {
    final res = await _api.get('/v1/stores/$slug/products');
    final list = (res['products'] as List?) ?? const [];
    return list
        .map((e) => ProductSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/products/:id — one product with variants and stock.
  Future<ProductDetail> product(String id) async {
    final res = await _api.get('/v1/products/$id');
    return ProductDetail.fromJson(res);
  }

  /// GET /v1/orders/:id — one order's fulfilment status.
  Future<OrderStatus> order(String orderId) async {
    final res = await _api.get('/v1/orders/$orderId');
    return OrderStatus.fromJson(res);
  }

  /// Resolve a human voucher code (VCH-XXXXXX) to its card id, or null
  /// when the server doesn't know it.
  Future<String?> resolveVoucherCode(String code) async {
    final r = await _api.get(
      '/v1/vouchers/resolve?code=${Uri.encodeComponent(code.trim())}',
    );
    final id = (r['voucher'] as Map<String, dynamic>?)?['id'] as String?;
    return (id == null || id.isEmpty) ? null : id;
  }

  /// POST /v1/orders — single-product checkout. The screen owns the
  /// stage machine (placing → waiting → done/failed) and the STK poll
  /// loop; this just shapes the payload and the placed-order answer.
  Future<PlacedOrder> placeOrder({
    required String storeSlug,
    required String productId,
    String? variantId,
    required int quantity,
    required String buyerName,
    required String buyerMsisdn,
    required String paymentMethod,
    String? voucherId,
  }) async {
    final res = await _api.post('/v1/orders', {
      'storeSlug': storeSlug,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
      'paymentMethod': paymentMethod,
      if (voucherId case var id) 'voucherId': id,
      'items': [
        {
          'productId': productId,
          if (variantId case var vid) 'variantId': vid,
          'quantity': quantity,
        },
      ],
    });
    return PlacedOrder(
      orderId: res['orderId'] as String?,
      totalKes: res['totalKes'] as String?,
      paid: _isPaid(res),
    );
  }

  /// True once the order's status has flipped to PAID (webhook or
  /// console auto-confirm) — the poll loop calls this, not the screen.
  Future<bool> isOrderPaid(String orderId) async {
    final res = await _api.get('/v1/orders/$orderId');
    return _isPaid(res);
  }

  static bool _isPaid(Map<String, dynamic> res) {
    // API has returned both `status` and `Status` historically.
    final s = res['status'] ?? res['Status'];
    return (s as String?)?.toUpperCase() == 'PAID';
  }
}

/// The shaped answer to POST /v1/orders the checkout stage machine acts on.
class PlacedOrder {
  const PlacedOrder({this.orderId, this.totalKes, required this.paid});

  final String? orderId;
  final String? totalKes;
  final bool paid;
}
