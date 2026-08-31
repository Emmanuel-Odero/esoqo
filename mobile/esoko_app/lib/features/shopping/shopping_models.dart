/// Wire types matching core-go's Go struct JSON — see
/// services/core-go/internal/dbx/store.go (field names are the Go
/// struct's own exported names, since those handlers return the struct
/// straight through gin.JSON rather than a hand-shaped map).
class StoreSummary {
  StoreSummary({required this.id, required this.slug, required this.name, this.tagline, this.logoUrl, this.primaryCategory});

  factory StoreSummary.fromJson(Map<String, dynamic> json) => StoreSummary(
        id: json['ID'] as String,
        slug: json['Slug'] as String,
        name: json['Name'] as String,
        tagline: json['Tagline'] as String?,
        logoUrl: json['LogoURL'] as String?,
        primaryCategory: json['PrimaryCategory'] as String?,
      );

  final String id;
  final String slug;
  final String name;
  final String? tagline;
  final String? logoUrl;
  final String? primaryCategory;
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
