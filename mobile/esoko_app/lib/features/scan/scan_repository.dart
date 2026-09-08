import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/providers.dart';

/// A scanned fare receipt shown to crew-less passengers — the wire's
/// status card without any raw maps reaching the screen.
class ScanFareProof {
  ScanFareProof({
    required this.status,
    required this.amountKes,
    required this.orgName,
    required this.vehiclePlate,
    required this.routeName,
    required this.ageMinutes,
  });

  factory ScanFareProof.fromJson(Map<String, dynamic> json) => ScanFareProof(
    status: json['status'] as String? ?? '',
    amountKes: json['amountKes'] as String? ?? '',
    orgName: json['orgName'] as String? ?? '',
    vehiclePlate: json['vehiclePlate'] as String? ?? '',
    routeName: json['routeName'] as String? ?? '—',
    ageMinutes: (json['ageMinutes'] as num?)?.toInt() ?? 0,
  );

  final String status;
  final String amountKes;
  final String orgName;
  final String vehiclePlate;
  final String routeName;
  final int ageMinutes;
}

/// Public event-ticket stub resolved from a TKT-… code — the guest-safe
/// view of a scanned ticket (class, event, seat, status).
class ScanTicketInfo {
  ScanTicketInfo({
    required this.code,
    required this.status,
    required this.className,
    required this.priceKes,
    required this.eventName,
    required this.orgName,
    this.seatLabel,
  });

  factory ScanTicketInfo.fromJson(Map<String, dynamic> json) =>
      ScanTicketInfo(
        code: json['code'] as String? ?? '',
        status: json['status'] as String? ?? '',
        className: json['className'] as String? ?? '',
        priceKes: json['priceKes'] as String? ?? '',
        eventName: json['eventName'] as String? ?? '',
        orgName: json['orgName'] as String? ?? '',
        seatLabel: json['seatLabel'] as String?,
      );

  final String code;
  final String status;
  final String className;
  final String priceKes;
  final String eventName;
  final String orgName;
  final String? seatLabel;
}

/// Pickup status card resolved from a PKP-… code — what a buyer or shop
/// staff sees when pointing at the printed sticker.
class ScanOrderInfo {
  ScanOrderInfo({
    required this.pickupCode,
    required this.status,
    required this.storeName,
    required this.totalKes,
    this.readyAt,
  });

  factory ScanOrderInfo.fromJson(Map<String, dynamic> json) =>
      ScanOrderInfo(
        pickupCode: json['pickupCode'] as String? ?? '',
        status: json['status'] as String? ?? '',
        storeName: json['storeName'] as String? ?? '',
        totalKes: json['totalKes'] as String? ?? '',
        readyAt: json['readyAt'] as String?,
      );

  final String pickupCode;
  final String status;
  final String storeName;
  final String totalKes;
  final String? readyAt;
}

/// Public payment card resolved from an ESK-…-KE code — who a peer or a
/// register is pointing their camera at, before any money moves.
class ScanPartyInfo {
  ScanPartyInfo({
    required this.esokoId,
    required this.displayName,
    required this.verified,
    required this.organisation,
  });

  factory ScanPartyInfo.fromJson(Map<String, dynamic> json) => ScanPartyInfo(
    esokoId: json['esokoId'] as String? ?? '',
    displayName: json['displayName'] as String? ?? 'Esoko member',
    verified: json['verified'] as bool? ?? false,
    organisation: json['organisation'] as bool? ?? false,
  );

  final String esokoId;
  final String displayName;
  final bool verified;
  final bool organisation;
}

/// Public certificate card — the mobile twin of the website's /verify
/// page: is this printed credential real, and who holds it.
class ScanCertInfo {
  ScanCertInfo({
    required this.found,
    required this.status,
    required this.claimType,
    required this.holder,
    required this.issuer,
    required this.issuedOn,
    this.validUntil,
  });

  factory ScanCertInfo.fromJson(Map<String, dynamic> json) => ScanCertInfo(
    found: json['found'] as bool? ?? false,
    status: json['status'] as String? ?? 'expired',
    claimType: json['claimType'] as String? ?? '',
    holder: json['holder'] as String? ?? '',
    issuer: json['issuer'] as String? ?? 'Esoko',
    issuedOn: json['issuedOn'] as String? ?? '',
    validUntil: json['validUntil'] as String?,
  );

  final bool found;
  final String status;
  final String claimType;
  final String holder;
  final String issuer;
  final String issuedOn;
  final String? validUntil;
}

/// What one scan resolved to — kind, the server's action hint, and the
/// routing payload the screen needs. Go owns the actual dispatch
/// (GET /v1/scan/resolve); this class is the wire's cards, never raw
/// maps.
class ScanResolution {
  const ScanResolution({
    required this.kind,
    required this.action,
    this.fare,
    this.productId,
    this.productVariantId,
    this.productName,
    this.productPriceKes,
    this.storeSlug,
    this.storeName,
    this.tableLabel,
    this.ticket,
    this.order,
    this.party,
    this.certificate,
  });

  final String kind;
  final String action;

  /// Set when kind == 'fare' and the passenger isn't crew.
  final ScanFareProof? fare;

  /// Set when kind == 'product'.
  final String? productId;

  /// Set when kind == 'product' and the SKU resolved to a variant.
  final String? productVariantId;

  /// Set when kind == 'product' — the basket-mode line label, so the
  /// scanner never has to re-fetch product detail to show a basket row.
  final String? productName;

  /// Set when kind == 'product'.
  final String? productPriceKes;

  /// Set when kind == 'store', 'table', or 'product'.
  final String? storeSlug;

  /// Set when kind == 'store', 'table', or 'product'.
  final String? storeName;

  /// Set when kind == 'table'.
  final String? tableLabel;

  /// Set when kind == 'ticket'.
  final ScanTicketInfo? ticket;

  /// Set when kind == 'order'.
  final ScanOrderInfo? order;

  /// Set when kind == 'party'.
  final ScanPartyInfo? party;

  /// Set when kind == 'certificate' (found or not).
  final ScanCertInfo? certificate;

  static const unknown = ScanResolution(kind: 'unknown', action: 'info');

  /// Whether the scan resolved to something the screen can render
  /// inline (a card) rather than a route to a full feature screen.
  bool get isInlineResult => ['fare', 'ticket', 'order', 'party', 'certificate'].contains(kind);
}

/// The scan feature slice of the Riverpod convention — one call for the
/// universal scanner, reshaped from the raw kind/entity maps.
final scanRepositoryProvider = Provider<ScanRepository>((ref) {
  return ScanRepository(ref.watch(apiClientProvider));
});

class ScanRepository {
  ScanRepository(this._api);

  final ApiClient _api;

  /// GET /v1/scan/resolve?code= — sniffs the code kind (trip, voucher,
  /// fare, product, store, table, ticket, order, party, certificate)
  /// and returns the routing payload.
  Future<ScanResolution> resolve(String code) async {
    final res = await _api.get(
      '/v1/scan/resolve?code=${Uri.encodeComponent(code)}',
    );
    final kind = res['kind'] as String? ?? 'unknown';
    final action = res['action'] as String? ?? 'info';
    switch (kind) {
      case 'fare':
        return ScanResolution(
          kind: kind,
          action: action,
          fare: ScanFareProof.fromJson(
            (res['fare'] as Map<String, dynamic>?) ?? const {},
          ),
        );
      case 'product':
        final p = res['product'] as Map<String, dynamic>?;
        return ScanResolution(
          kind: kind,
          action: action,
          productId: p?['productId'] as String?,
          productVariantId: p?['variantId'] as String?,
          productName: p?['name'] as String?,
          productPriceKes: p?['priceKes'] as String?,
          storeSlug: p?['storeSlug'] as String?,
          storeName: p?['storeName'] as String?,
        );
      case 'store':
        final s = res['store'] as Map<String, dynamic>?;
        return ScanResolution(
          kind: kind,
          action: action,
          storeSlug: s?['slug'] as String?,
          storeName: s?['name'] as String?,
        );
      case 'table':
        final t = res['table'] as Map<String, dynamic>?;
        return ScanResolution(
          kind: kind,
          action: action,
          storeSlug: t?['storeSlug'] as String?,
          storeName: t?['storeName'] as String?,
          tableLabel: t?['tableLabel'] as String?,
        );
      case 'ticket':
        return ScanResolution(
          kind: kind,
          action: action,
          ticket: ScanTicketInfo.fromJson(
            (res['ticket'] as Map<String, dynamic>?) ?? const {},
          ),
        );
      case 'order':
        return ScanResolution(
          kind: kind,
          action: action,
          order: ScanOrderInfo.fromJson(
            (res['order'] as Map<String, dynamic>?) ?? const {},
          ),
        );
      case 'party':
        return ScanResolution(
          kind: kind,
          action: action,
          party: ScanPartyInfo.fromJson(
            (res['party'] as Map<String, dynamic>?) ?? const {},
          ),
        );
      case 'certificate':
        return ScanResolution(
          kind: kind,
          action: action,
          certificate: ScanCertInfo.fromJson(
            (res['certificate'] as Map<String, dynamic>?) ?? const {},
          ),
        );
      case 'trip':
      case 'voucher':
        return ScanResolution(kind: kind, action: action);
      default:
        return ScanResolution.unknown;
    }
  }
}