import 'package:flutter/material.dart';

import '../../core/theme/esoko_tokens.dart';

/// Visual identity per product/store category — an icon and a gradient,
/// since the seeded demo catalogue has no real photography yet (see
/// services/core-go's Go seeder). Keeps every card/banner in Shopping
/// looking designed instead of a placeholder box, and gives a shopper a
/// category cue at a glance the way a real storefront's photos would.
class CategoryStyle {
  const CategoryStyle(this.icon, this.gradient);
  final IconData icon;
  final List<Color> gradient;

  static const _fallback = CategoryStyle(Icons.storefront_rounded, [EsokoColors.navy2, EsokoColors.navy]);

  static const _byKeyword = <String, CategoryStyle>{
    'vegetable': CategoryStyle(Icons.eco_rounded, [Color(0xFF2E9E5B), Color(0xFF12794A)]),
    'fruit': CategoryStyle(Icons.local_grocery_store_rounded, [Color(0xFFE0A233), Color(0xFFB9790F)]),
    'produce': CategoryStyle(Icons.agriculture_rounded, [Color(0xFF2E9E5B), Color(0xFF12794A)]),
    'hardware': CategoryStyle(Icons.hardware_rounded, [Color(0xFF5A7695), Color(0xFF1B527E)]),
    'construction': CategoryStyle(Icons.construction_rounded, [Color(0xFF5A7695), Color(0xFF1B527E)]),
    'building': CategoryStyle(Icons.foundation_rounded, [Color(0xFF5A7695), Color(0xFF1B527E)]),
    'tool': CategoryStyle(Icons.build_rounded, [Color(0xFF5A7695), Color(0xFF1B527E)]),
    'agriculture': CategoryStyle(Icons.grass_rounded, [Color(0xFF2E9E5B), Color(0xFF12794A)]),
    'service': CategoryStyle(Icons.design_services_rounded, [Color(0xFF3F8AC4), Color(0xFF0F5C9E)]),
    'cloth': CategoryStyle(Icons.checkroom_rounded, [Color(0xFFC65DA6), Color(0xFF8E3D77)]),
  };

  static CategoryStyle forCategory(String? category) {
    if (category == null) return _fallback;
    final lower = category.toLowerCase();
    for (final entry in _byKeyword.entries) {
      if (lower.contains(entry.key)) return entry.value;
    }
    return _fallback;
  }
}
