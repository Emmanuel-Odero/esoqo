import 'package:flutter/material.dart';

import '../../core/theme/esoqo_tokens.dart';

/// Visual identity per product/store category — an icon and a gradient,
/// since the seeded demo catalogue has no real photography yet (see
/// services/core-go's Go seeder). Keeps every card/banner in Shopping
/// looking designed instead of a placeholder box, and gives a shopper a
/// category cue at a glance the way a real storefront's photos would.
class CategoryStyle {
  const CategoryStyle(this.icon, this.gradient);
  final IconData icon;
  final List<Color> gradient;

  static const _fallback = CategoryStyle(Icons.storefront_rounded, [EsoqoColors.navy2, EsoqoColors.navy]);

  static const _byKeyword = <String, CategoryStyle>{
    'vegetable': CategoryStyle(Icons.eco_rounded, [EsoqoColors.greenLight, EsoqoColors.green]),
    'fruit': CategoryStyle(Icons.local_grocery_store_rounded, [EsoqoColors.amberLight, EsoqoColors.amberDeep]),
    'produce': CategoryStyle(Icons.agriculture_rounded, [EsoqoColors.greenLight, EsoqoColors.green]),
    'hardware': CategoryStyle(Icons.hardware_rounded, [EsoqoColors.text3, EsoqoColors.navy3]),
    'construction': CategoryStyle(Icons.construction_rounded, [EsoqoColors.text3, EsoqoColors.navy3]),
    'building': CategoryStyle(Icons.foundation_rounded, [EsoqoColors.text3, EsoqoColors.navy3]),
    'tool': CategoryStyle(Icons.build_rounded, [EsoqoColors.text3, EsoqoColors.navy3]),
    'agriculture': CategoryStyle(Icons.grass_rounded, [EsoqoColors.greenLight, EsoqoColors.green]),
    'service': CategoryStyle(Icons.design_services_rounded, [EsoqoColors.blue2, EsoqoColors.blue]),
    'cloth': CategoryStyle(Icons.checkroom_rounded, [EsoqoColors.pink, EsoqoColors.pinkDark]),
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
