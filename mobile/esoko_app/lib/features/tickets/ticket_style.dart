import 'package:flutter/material.dart';

/// Visual identity per listing vertical — mirrors
/// lib/features/shopping/category_style.dart's role for products, since
/// listings have no cover photo yet either.
class TicketStyle {
  const TicketStyle(this.icon, this.gradient);
  final IconData icon;
  final List<Color> gradient;

  static const events = TicketStyle(Icons.celebration_rounded, [Color(0xFFC65DA6), Color(0xFF7C3D8E)]);
  static const transport = TicketStyle(Icons.directions_bus_filled_rounded, [Color(0xFF3F8AC4), Color(0xFF0A2E4D)]);

  static TicketStyle forVertical(String vertical) => vertical == 'TRANSPORT' ? transport : events;
}
