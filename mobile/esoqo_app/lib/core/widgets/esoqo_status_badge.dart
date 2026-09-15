import 'package:flutter/material.dart';

/// The circular icon badge used at each stage of a payment-wizard flow
/// (waiting for M-Pesa, done, failed) — found duplicated verbatim
/// between checkout_screen.dart and schedule_booking_screen.dart before
/// this, one copy per checkout flow. A `spinning` ring around the badge
/// signals an in-progress wait (e.g. "complete payment on your phone").
class EsokoStatusBadge extends StatelessWidget {
  const EsokoStatusBadge({super.key, required this.icon, required this.color, this.spinning = false});

  final IconData icon;
  final Color color;
  final bool spinning;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 88,
      height: 88,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (spinning) const SizedBox(width: 88, height: 88, child: CircularProgressIndicator(strokeWidth: 3)),
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 32),
          ),
        ],
      ),
    );
  }
}
