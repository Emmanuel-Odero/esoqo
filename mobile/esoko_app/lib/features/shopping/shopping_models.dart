/// Wire types matching core-go's Go struct JSON — see
/// services/core-go/internal/dbx/store.go (field names are the Go
/// struct's own exported names, since those handlers return the struct
/// straight through gin.JSON rather than a hand-shaped map).
class StoreSummary {
  StoreSummary({
    required this.id, required this.slug, required this.name, this.tagline, this.logoUrl, this.primaryCategory,
    this.neighborhood, this.latitude, this.longitude,
  });

  factory StoreSummary.fromJson(Map<String, dynamic> json) => StoreSummary(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        name: json['Name'] as String,
        tagline: json['Tagline'] as String?,
        logoUrl: json['LogoURL'] as String?,
        primaryCategory: json['PrimaryCategory'] as String?,
        neighborhood: json['Neighborhood'] as String?,
        latitude: json['Latitude'] as String?,
        longitude: json['Longitude'] as String?,
      );

  final String id;
  final String slug;
  final String name;
  final String? tagline;
  final String? logoUrl;
  final String? primaryCategory;
  final String? neighborhood;
  final String? latitude;
  final String? longitude;
}

/// One row from GET /v1/stores/nearby — a StoreSummary plus how far
/// away it is, when the caller supplied a device location at all (null
/// in neighborhood-text-search mode). See dbx.ListStoresNearby.
class NearbyStore extends StoreSummary {
  NearbyStore({
    required super.id, required super.slug, required super.name, super.tagline, super.logoUrl, super.primaryCategory,
    super.neighborhood, super.latitude, super.longitude, this.distanceKm,
  });

  factory NearbyStore.fromJson(Map<String, dynamic> json) => NearbyStore(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        name: json['Name'] as String,
        tagline: json['Tagline'] as String?,
        logoUrl: json['LogoURL'] as String?,
        primaryCategory: json['PrimaryCategory'] as String?,
        neighborhood: json['Neighborhood'] as String?,
        latitude: json['Latitude'] as String?,
        longitude: json['Longitude'] as String?,
        distanceKm: (json['DistanceKM'] as num?)?.toDouble(),
      );

  final double? distanceKm;
}

/// One row of GET /v1/me/saved-stores — a StoreSummary plus when it was
/// saved. See dbx.ListSavedStores.
class SavedStore extends StoreSummary {
  SavedStore({
    required super.id, required super.slug, required super.name, super.tagline, super.logoUrl, super.primaryCategory,
    required this.savedAt,
  });

  factory SavedStore.fromJson(Map<String, dynamic> json) => SavedStore(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        name: json['Name'] as String,
        tagline: json['Tagline'] as String?,
        logoUrl: json['LogoURL'] as String?,
        primaryCategory: json['PrimaryCategory'] as String?,
        savedAt: json['SavedAt'] as String? ?? '',
      );

  final String savedAt;
}

/// GET /v1/stores/:slug/usual's answer — the signed-in buyer's
/// most-frequently-ordered product at this store, or null when they've
/// never ordered from it (or aren't signed in). See dbx.UsualProduct.
class UsualProduct {
  const UsualProduct({
    required this.productId,
    required this.name,
    required this.priceKes,
    this.variantId,
  });

  factory UsualProduct.fromJson(Map<String, dynamic> json) => UsualProduct(
        productId: json['ProductID'] as String,
        name: json['Name'] as String,
        priceKes: json['PriceKES'] as String,
        variantId: json['VariantID'] as String?,
      );

  final String productId;
  final String name;
  final String priceKes;
  final String? variantId;
}

class StoreDetail extends StoreSummary {
  StoreDetail({
    required super.id, required super.slug, required super.name, super.tagline, super.logoUrl, super.primaryCategory,
    this.aboutUs, this.contactPhone, required this.codEnabled,
  });

  factory StoreDetail.fromJson(Map<String, dynamic> json) => StoreDetail(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        name: json['Name'] as String,
        tagline: json['Tagline'] as String?,
        logoUrl: json['LogoURL'] as String?,
        primaryCategory: json['PrimaryCategory'] as String?,
        aboutUs: json['AboutUs'] as String?,
        contactPhone: json['ContactPhone'] as String?,
        codEnabled: json['CodEnabled'] as bool? ?? false,
      );

  final String? aboutUs;
  final String? contactPhone;
  final bool codEnabled;
}

class ProductSummary {
  ProductSummary({
    required this.id, required this.name, required this.priceKes, this.category,
    this.imageUrl, this.stockQty, required this.availableOnOrder, required this.isService,
  });

  factory ProductSummary.fromJson(Map<String, dynamic> json) => ProductSummary(
        id: json['ID'] as String,
        name: json['Name'] as String,
        priceKes: json['PriceKES'] as String,
        category: json['Category'] as String?,
        imageUrl: json['ImageURL'] as String?,
        stockQty: json['StockQty'] as int?,
        availableOnOrder: json['AvailableOnOrder'] as bool? ?? false,
        isService: json['IsService'] as bool? ?? false,
      );

  final String id;
  final String name;
  final String priceKes;
  final String? category;
  final String? imageUrl;
  final int? stockQty;
  final bool availableOnOrder;
  final bool isService;
}

class ProductVariant {
  ProductVariant({required this.id, required this.label, required this.priceKes, this.stockQty});

  factory ProductVariant.fromJson(Map<String, dynamic> json) => ProductVariant(
        id: json['ID'] as String,
        label: json['Label'] as String,
        priceKes: json['PriceKES'] as String,
        stockQty: json['StockQty'] as int?,
      );

  final String id;
  final String label;
  final String priceKes;
  final int? stockQty;
}

class ProductDetail extends ProductSummary {
  ProductDetail({
    required super.id, required super.name, required super.priceKes, super.category, super.imageUrl,
    super.stockQty, required super.availableOnOrder, required super.isService,
    this.description, this.unit, required this.storeId, required this.storeName, required this.storeSlug,
    this.variants = const [],
  });

  factory ProductDetail.fromJson(Map<String, dynamic> json) => ProductDetail(
        id: json['ID'] as String,
        name: json['Name'] as String,
        priceKes: json['PriceKES'] as String,
        category: json['Category'] as String?,
        imageUrl: json['ImageURL'] as String?,
        stockQty: json['StockQty'] as int?,
        availableOnOrder: json['AvailableOnOrder'] as bool? ?? false,
        isService: json['IsService'] as bool? ?? false,
        description: json['Description'] as String?,
        unit: json['Unit'] as String?,
        storeId: json['StoreID'] as String,
        storeName: json['StoreName'] as String,
        storeSlug: json['StoreSlug'] as String,
        variants: ((json['Variants'] as List?) ?? const [])
            .map((e) => ProductVariant.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String? description;
  final String? unit;
  final String storeId;
  final String storeName;
  final String storeSlug;
  final List<ProductVariant> variants;
}

/// GET /v1/orders/:id and GET /v1/me/orders — see dbx.OrderStatus.
/// PickupCode/ReadyAt/FulfilmentKind only populate for PICKUP orders
/// (see core-go's ConfirmStoreOrderPaymentByCheckoutID/
/// MarkOrderReadyForPickup — a DELIVERY order never gets a pickup code).
class OrderStatus {
  OrderStatus({
    required this.id, required this.storeName, required this.status, required this.totalKes, required this.createdAt,
    this.pickupCode, this.readyAt, this.fulfilmentKind, this.storeNeighborhood, this.storeLatitude, this.storeLongitude,
  });

  factory OrderStatus.fromJson(Map<String, dynamic> json) => OrderStatus(
        id: json['ID'] as String,
        storeName: json['StoreName'] as String,
        status: json['Status'] as String,
        totalKes: json['TotalKES'] as String,
        createdAt: json['CreatedAt'] as String,
        pickupCode: json['PickupCode'] as String?,
        readyAt: json['ReadyAt'] as String?,
        fulfilmentKind: json['FulfilmentKind'] as String?,
        storeNeighborhood: json['StoreNeighborhood'] as String?,
        storeLatitude: json['StoreLatitude'] as String?,
        storeLongitude: json['StoreLongitude'] as String?,
      );

  final String id;
  final String storeName;
  final String status; // PENDING_PAYMENT | PAID | READY_FOR_PICKUP | FULFILLED | CANCELLED
  final String totalKes;
  final String createdAt;
  final String? pickupCode;
  final String? readyAt;
  final String? fulfilmentKind; // PICKUP | DELIVERY
  final String? storeNeighborhood;
  final String? storeLatitude;
  final String? storeLongitude;

  bool get isPickup => fulfilmentKind == 'PICKUP';
}
