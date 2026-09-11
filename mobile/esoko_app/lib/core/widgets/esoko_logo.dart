import 'package:flutter/material.dart';

/// The real Esoko logo — the red shopping-cart "e" + green "soko"
/// wordmark, as shipped in assets/branding/esoko-full-logo-clean.png
/// (the same file already used for the native splash screen, see
/// pubspec.yaml's flutter_native_splash config). This replaces an
/// earlier hand-drawn CustomPainter approximation (a minimalist navy
/// arc/bar/stem mark) that didn't actually match this asset — the app
/// was rendering two different logos in different places.
///
/// Full colour, not recolourable: unlike the old mark, this is a fixed
/// multi-colour raster image, so there's no light/dark or "inverse"
/// variant to switch between — the red/green reads fine against every
/// background this lockup appears on (navy app bar, paper/dark
/// scaffold), the same way it already did on the splash screen.
class EsokoBrandLockup extends StatelessWidget {
  const EsokoBrandLockup({
    super.key,
    this.size = 30,
    this.mainAxisAlignment = MainAxisAlignment.start,
  });

  /// Rendered height — width follows the asset's own aspect ratio.
  final double size;
  final MainAxisAlignment mainAxisAlignment;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: mainAxisAlignment,
      children: [
        Image.asset(
          'assets/branding/esoko-full-logo-clean.png',
          height: size,
          fit: BoxFit.contain,
          semanticLabel: 'Esoko',
        ),
      ],
    );
  }
}
