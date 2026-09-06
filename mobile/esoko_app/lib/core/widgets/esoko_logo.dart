import 'package:flutter/material.dart';

import '../theme/esoko_tokens.dart';

/// Esoko's mark, drawn to match packages/ui/src/Logo.tsx's SVG — three
/// strokes reading as an "E" (a sweeping arc, a horizontal bar, a
/// diagonal stem). Rendered with a [CustomPainter] so the app needs no
/// SVG dependency and the lockup stays crisp at any size.
///
/// [color] defaults to navy ("authority" — the standard lockup); pass a
/// light colour for navy/dark surfaces.
class EsokoLogo extends StatelessWidget {
  const EsokoLogo({super.key, this.color = EsokoColors.navy, this.size = const Size(30, 28)});

  final Color color;
  final Size size;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: size,
      painter: _EsokoMarkPainter(color: color),
    );
  }
}

class _EsokoMarkPainter extends CustomPainter {
  const _EsokoMarkPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    // Stroke width scales with the box — 12 units of the 132-wide viewBox.
    final stroke = w / 132 * 12.0;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Scale the 132×124 viewBox into our box, centring vertically.
    final s = w / 132;
    final dy = (h - 124 * s) / 2;
    Offset p(num x, num y) => Offset(x * s, y * s + dy);

    // The arc — `M 118 62 A 40 40 0 1 0 110.8 84.9`. Flutter's
    // arcToPoint mirrors SVG's elliptical arc command; `clockwise: true`
    // (SVG sweep-flag 1) reproduces the outer sweep of the "E".
    final arc = Path()
      ..moveTo(p(118, 62).dx, p(118, 62).dy)
      ..arcToPoint(
        p(110.8, 84.9),
        radius: Radius.circular(40 * s),
        clockwise: true,
      );
    canvas.drawPath(arc, paint);

    // The horizontal bar — `M 38 62 L 118 62`.
    canvas.drawLine(p(38, 62), p(118, 62), paint);

    // The diagonal stem — `M 38 62 L 8 45`.
    canvas.drawLine(p(38, 62), p(8, 45), paint);
  }

  @override
  bool shouldRepaint(covariant _EsokoMarkPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// The full brand lockup — mark + "esoko" wordmark — matching the web's
/// Logo.tsx. `inverse` renders white for navy/dark surfaces (app bars);
/// otherwise navy (the standard lockup on paper/white).
class EsokoBrandLockup extends StatelessWidget {
  const EsokoBrandLockup({super.key, this.inverse = false, this.size = 30, this.mainAxisAlignment = MainAxisAlignment.start});

  final bool inverse;
  final double size;
  final MainAxisAlignment mainAxisAlignment;

  @override
  Widget build(BuildContext context) {
    final color = inverse ? Colors.white : EsokoColors.navy;
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: mainAxisAlignment,
      children: [
        EsokoLogo(color: color, size: Size(size, size * 0.93)),
        const SizedBox(width: EsokoSpacing.s1),
        Text(
          'esoko',
          style: TextStyle(
            color: color,
            fontFamily: EsokoFonts.display,
            fontSize: size * 0.8,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.8 * (size / 30),
          ),
        ),
      ],
    );
  }
}