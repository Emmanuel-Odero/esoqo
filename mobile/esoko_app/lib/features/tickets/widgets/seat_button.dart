import 'package:flutter/material.dart';

import '../../../core/theme/esoko_tokens.dart';
import '../ticketing_models.dart';

class SeatButton extends StatelessWidget {
  const SeatButton({
    super.key,
    required this.seat,
    required this.selected,
    required this.onTap,
  });
  final SeatRow seat;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final taken = seat.status != 'AVAILABLE';
    // Available seats sit on the scheme surface, never a hardcoded
    // white — the seat map stays legible in dark mode.
    final Color bg = taken
        ? EsokoColors.line
        : (selected
              ? EsokoColors.green
              : Theme.of(context).colorScheme.surface);
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    final Color? fg = taken
        ? muted?.withValues(alpha: 0.6)
        : (selected ? Colors.white : muted);
    return SizedBox(
      width: 36,
      height: 36,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(EsokoRadius.sm),
        child: InkWell(
          onTap: taken ? null : onTap,
          borderRadius: BorderRadius.circular(EsokoRadius.sm),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EsokoRadius.sm),
              border: Border.all(
                color: selected ? EsokoColors.green : EsokoColors.line,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.event_seat, size: 14, color: fg),
                Text(
                  seat.label,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
