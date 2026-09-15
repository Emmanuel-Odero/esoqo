import 'package:flutter/material.dart';

import '../../core/theme/esoqo_tokens.dart';

/// Visual identity per listing vertical — mirrors
/// lib/features/shopping/category_style.dart's role for products, since
/// listings have no cover photo yet either.
class TicketStyle {
  const TicketStyle(this.icon, this.gradient);
  final IconData icon;
  final List<Color> gradient;

  static const events = TicketStyle(Icons.celebration_rounded, [EsoqoColors.pink, EsoqoColors.purple]);
  static const transport = TicketStyle(Icons.directions_bus_filled_rounded, [EsoqoColors.blue2, EsoqoColors.navy]);

  static TicketStyle forVertical(String vertical) => vertical == 'TRANSPORT' ? transport : events;
}
