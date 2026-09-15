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

  /// GET /v1/me/saved-stores — "My spots": stores this person has
  /// bookmarked, newest-saved first.
  Future<List<SavedStore>> savedStores() async {
    final res = await _api.get('/v1/me/saved-stores');
    final list = (res['stores'] as List?) ?? const [];
    return list
        .map((e) => SavedStore.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/me/saved-stores/:storeId — idempotent; saving twice is a
  /// no-op on the server, never an error.
  Future<void> saveStore(String storeId) =>
      _api.post('/v1/me/saved-stores/$storeId');

  /// DELETE /v1/me/saved-stores/:storeId — likewise idempotent.
  Future<void> unsaveStore(String storeId) =>
      _api.delete('/v1/me/saved-stores/$storeId');

  /// GET /v1/stores/:slug/usual — the signed-in buyer's most-frequently
  /// -ordered product at this store, or null (never ordered here, or
  /// signed out).
  Future<UsualProduct?> usualProduct(String slug) async {
    final res = await _api.get('/v1/stores/$slug/usual');
    final usual = res['usual'] as Map<String, dynamic>?;
    return usual == null ? null : UsualProduct.fromJson(usual);
  }

  /// GET /v1/orders/:id — one order's fulfilment status.
  Future<OrderStatus> order(String orderId) async {
    final res = await _api.get('/v1/orders/$orderId');
    return OrderStatus.fromJson(res);
  }

  /// GET /v1/me/orders — every order this buyer has ever placed, newest
  /// first (see dbx.ListOrdersForParty). The model already documented
  /// this route; nothing on the client had called it until the Shopping
  /// hub needed to lead with ready-for-pickup orders.
  Future<List<OrderStatus>> myOrders() async {
    final res = await _api.get('/v1/me/orders');
    final list = (res['orders'] as List?) ?? const [];
    return list.map((e) => OrderStatus.fromJson(e as Map<String, dynamic>)).toList();
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

  /// GET /v1/orders/:id — the full status view, including dine-in
  /// fields. Separate from isOrderPaid (which only cares about one
  /// bool) because the table-order confirmation screen needs the whole
  /// picture: table, kitchen status, tip.
  Future<OrderStatus> orderStatus(String orderId) async {
    final res = await _api.get('/v1/orders/$orderId');
    return OrderStatus.fromJson(res);
  }

  /// POST /v1/orders — table-attached, multi-item. Deliberately a
  /// separate method from placeOrder (single retail item) rather than
  /// widening that one — see checkout_screen.dart's own note on why
  /// retail stays single-item; a dine-in order is a basket by nature,
  /// a retail "buy this one thing" tap is not.
  Future<PlacedOrder> placeTableOrder({
    required String storeSlug,
    required String tableLabel,
    required Map<String, int> quantitiesByProductId,
    required String buyerName,
    required String buyerMsisdn,
  }) async {
    final res = await _api.post('/v1/orders', {
      'storeSlug': storeSlug,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
      'paymentMethod': 'MPESA_STK',
      'tableLabel': tableLabel,
      'items': [
        for (final entry in quantitiesByProductId.entries)
          {'productId': entry.key, 'quantity': entry.value},
      ],
    });
    return PlacedOrder(
      orderId: res['orderId'] as String?,
      totalKes: res['totalKes'] as String?,
      paid: _isPaid(res),
    );
  }

  /// POST /v1/orders/:id/tip — guest-safe by design (see
  /// dbx.AddTip's own comment on why: a guest checkout must be able to
  /// tip too).
  Future<void> addTip({required String orderId, required double tipKes}) {
    return _api.post('/v1/orders/$orderId/tip', {'tipKes': tipKes});
  }

  // ── staff: table board (store-owner-scoped — see dbx/dine_in.go) ──

  /// GET /v1/stores/:slug/tables — every dine-in order not yet CLOSED.
  Future<List<TableOrderRow>> tableOrders(String slug) async {
    final res = await _api.get('/v1/stores/$slug/tables');
    final list = (res['orders'] as List?) ?? const [];
    return list
        .map((e) => TableOrderRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/stores/orders/:id/dine-in-status.
  Future<void> updateDineInStatus({
    required String orderId,
    required String status,
  }) {
    return _api.post('/v1/stores/orders/$orderId/dine-in-status', {
      'status': status,
    });
  }

  /// POST /v1/stores/:slug/tables/:table/assign.
  Future<void> assignTable({
    required String slug,
    required String table,
    required String cashierId,
  }) {
    return _api.post('/v1/stores/$slug/tables/${Uri.encodeComponent(table)}/assign', {
      'cashierId': cashierId,
    });
  }

  /// GET /v1/stores/:slug/cashiers.
  Future<List<CashierRow>> cashiers(String slug) async {
    final res = await _api.get('/v1/stores/$slug/cashiers');
    final list = (res['cashiers'] as List?) ?? const [];
    return list
        .map((e) => CashierRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/stores/:slug/cashiers — adds a named staff member (a
  /// waiter) this store's table board can then assign to tables.
  Future<CashierRow> createCashier({
    required String slug,
    required String name,
    required String pin,
    String role = 'CASHIER',
  }) async {
    final res = await _api.post('/v1/stores/$slug/cashiers', {
      'name': name,
      'pin': pin,
      'role': role,
    });
    return CashierRow.fromJson(res['cashier'] as Map<String, dynamic>);
  }

  // ── mall self-checkout ─────────────────────────────────────────────

  /// POST /v1/orders — basket-built self-checkout, `isSelfCheckout: true`
  /// so the server mints an exit code the same way it mints a pickup
  /// code (see dbx.CreateOrderInput.IsSelfCheckout). A separate method
  /// from placeTableOrder for the same reason that one is separate from
  /// placeOrder: distinct semantics deserve their own name, even though
  /// the wire shape is nearly identical.
  Future<PlacedOrder> placeSelfCheckoutOrder({
    required String storeSlug,
    required Map<String, int> quantitiesByProductId,
    required String buyerName,
    required String buyerMsisdn,
  }) async {
    final res = await _api.post('/v1/orders', {
      'storeSlug': storeSlug,
      'buyerName': buyerName,
      'buyerMsisdn': buyerMsisdn,
      'paymentMethod': 'MPESA_STK',
      'isSelfCheckout': true,
      'items': [
        for (final entry in quantitiesByProductId.entries)
          {'productId': entry.key, 'quantity': entry.value},
      ],
    });
    return PlacedOrder(
      orderId: res['orderId'] as String?,
      totalKes: res['totalKes'] as String?,
      paid: _isPaid(res),
    );
  }

  /// POST /v1/stores/:slug/exit-code/resolve — the guard's verification
  /// step. Store-owner-scoped (see dbx.ResolveExitCode); throws
  /// ApiException with codes WRONG_CODE / NOT_PAID / FORBIDDEN, which
  /// the guard screen renders as a plain red result rather than a form
  /// error.
  Future<ExitCodeResult> resolveExitCode({
    required String storeSlug,
    required String code,
  }) async {
    final res = await _api.post(
      '/v1/stores/$storeSlug/exit-code/resolve',
      {'code': code},
    );
    return ExitCodeResult.fromJson(res);
  }
}

/// The guard-facing, PII-minimal answer to a resolved exit code — item
/// count and total only, never the buyer's name or phone (see
/// dbx.ExitCodeResult's own comment on why).
class ExitCodeResult {
  const ExitCodeResult({
    required this.orderId,
    required this.itemCount,
    required this.totalKes,
    required this.alreadyExited,
  });

  factory ExitCodeResult.fromJson(Map<String, dynamic> json) =>
      ExitCodeResult(
        orderId: json['orderId'] as String? ?? '',
        itemCount: (json['itemCount'] as num?)?.toInt() ?? 0,
        totalKes: json['totalKes'] as String? ?? '0',
        alreadyExited: json['alreadyExited'] as bool? ?? false,
      );

  final String orderId;
  final int itemCount;
  final String totalKes;
  final bool alreadyExited;
}

/// The shaped answer to POST /v1/orders the checkout stage machine acts on.
class PlacedOrder {
  const PlacedOrder({this.orderId, this.totalKes, required this.paid});

  final String? orderId;
  final String? totalKes;
  final bool paid;
}
