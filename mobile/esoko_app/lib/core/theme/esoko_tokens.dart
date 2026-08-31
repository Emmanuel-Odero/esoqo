/// Esoko's design tokens, ported from packages/ui/src/tokens.css — the
/// same single source of truth the web apps use. Colour semantics are a
/// rule, not a preference, and hold across every surface:
///
///   navy  = authority      · headers, footers, institutional chrome
///   green = you and yours  · your record, verified, primary action
///   blue  = institutions   · issuers, data, information
///   red   = attention only · the mark, safety notices, errors
///
/// Keep this file's values in lockstep with tokens.css by hand — there is
/// no shared build step between the CSS and Dart sides (see the "no
/// shared schema" note in docs/adr/0005-mobile-api-in-go.md; the same
/// gap applies to design tokens, not just API contracts).
library;

import 'package:flutter/material.dart';

abstract final class EsokoColors {
  static const navy = Color(0xFF0A2E4D);
  static const navy2 = Color(0xFF123F65);
  static const navy3 = Color(0xFF1B527E);

  static const blue = Color(0xFF0F5C9E);
  static const blue2 = Color(0xFF3F8AC4);
  static const blueTint = Color(0xFFE9F2F9);

  static const green = Color(0xFF12794A);
  static const green2 = Color(0xFF1FA163);
  static const greenTint = Color(0xFFE7F4ED);

  static const red = Color(0xFFCE2B2B);
  static const redTint = Color(0xFFFCEDEC);

  static const amber = Color(0xFF9A6105);
  static const amberTint = Color(0xFFFDF4E3);

  static const paper = Color(0xFFF4F7FA);
  static const line = Color(0xFFDCE5EC);

  static const text = Color(0xFF12283A);
  static const text2 = Color(0xFF57718A);
  static const text3 = Color(0xFF5A7695);

  // Dark-mode surface — tokens.css doesn't define one for the web apps
  // (light-only today), so this is new: a navy-rooted dark surface that
  // keeps the same hue family rather than a generic near-black, so the
  // "authority" association survives into dark mode.
  static const darkSurface = Color(0xFF0D1B29);
  static const darkSurface2 = Color(0xFF13293F);
}

/// 4px grid — --sp-1..--sp-9 in tokens.css.
abstract final class EsokoSpacing {
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 20.0;
  static const s6 = 24.0;
  static const s7 = 32.0;
  static const s8 = 40.0;
  static const s9 = 56.0;
}

/// --r-xs..--r-2xl in tokens.css.
abstract final class EsokoRadius {
  static const xs = 6.0;
  static const sm = 8.0;
  static const md = 10.0;
  static const lg = 14.0;
  static const xl = 20.0;
  static const xl2 = 28.0;
  static const pill = 999.0;
}

/// tokens.css's h1/h2/h3 rule: `font-weight:800; letter-spacing:-.028em;
/// line-height:1.1`. The web apps also swap in a distinct "Outfit"
/// display typeface there — this port keeps the platform's default
/// font (no bundled font assets in this app yet) and carries over the
/// weight/tracking voice, which is what actually reads as "on brand"
/// at a glance; introducing a new typeface is a bigger, separate call.
abstract final class EsokoTypography {
  static const headlineWeight = FontWeight.w800;
  static const headlineHeight = 1.1;
  // -.028em — a fraction of the style's own font size, not a fixed
  // pixel value, so it tightens proportionally at every text scale
  // (see EsokoTheme's own headline() helper, which multiplies this by
  // each TextStyle's fontSize).
  static const headlineTrackingEm = -0.028;
}
