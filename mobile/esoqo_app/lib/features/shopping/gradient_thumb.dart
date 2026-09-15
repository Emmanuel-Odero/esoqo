import 'package:flutter/material.dart';

import 'category_style.dart';

/// A category-gradient placeholder image — used everywhere a real photo
/// would go once stores upload one (Store.logoUrl / ProductImage are
/// already in the API response; this widget is what renders while
/// they're null, which is every seeded demo listing today).
class GradientThumb extends StatelessWidget {
  const GradientThumb({
    super.key,
    required this.category,
    this.isService = false,
    this.borderRadius = BorderRadius.zero,
    this.iconSize = 40,
  });

  final String? category;
  final bool isService;
  final BorderRadius borderRadius;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final style = CategoryStyle.forCategory(category);
    return ClipRRect(
      borderRadius: borderRadius,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: style.gradient,
          ),
        ),
        child: Center(
          child: Icon(
            isService ? Icons.handyman_rounded : style.icon,
            size: iconSize,
            color: Colors.white.withValues(alpha: 0.92),
          ),
        ),
      ),
    );
  }
}
