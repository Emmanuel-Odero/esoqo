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

/// Typefaces as named in tokens.css's --font-display/--font-body/
/// --font-mono. Web speaks with three distinct voices; the mobile app
/// used to bundle only Outfit and apply it everywhere (headings *and*
/// body *and* prices), which is why numbers and copy read flatter here
/// than on web. All three are now bundled (see pubspec.yaml) so the
/// same voice split applies on mobile.
abstract final class EsokoFonts {
  /// Display typeface — tokens.css's --font-display. Headings, section
  /// titles, anywhere the brand's bold/tight voice belongs.
  static const display = 'Outfit';

  /// Body typeface — tokens.css's --font-body. Paragraphs, labels,
  /// button text: the default reading voice everywhere that isn't a
  /// heading or a number.
  static const body = 'IBMPlexSans';

  /// Data/mono typeface — tokens.css's --font-mono. Prices, IDs, codes,
  /// anything tabular where digits need to line up and read
  /// unambiguously (a "0" must never be mistaken for an "8" on a phone
  /// screen in bright sun).
  static const mono = 'IBMPlexMono';
}

/// tokens.css's h1/h2/h3 rule: `font-weight:800; letter-spacing:-.028em;
/// line-height:1.1` — carried onto the bundled Outfit display typeface.
abstract final class EsokoTypography {
  static const headlineWeight = FontWeight.w800;
  static const headlineHeight = 1.1;
  // -.028em — a fraction of the style's own font size, not a fixed
  // pixel value, so it tightens proportionally at every text scale
  // (see EsokoTheme's own headline() helper, which multiplies this by
  // each TextStyle's fontSize).
  static const headlineTrackingEm = -0.028;

  /// Money/ID/code text — EsokoFonts.mono at a given size+weight, tabular
  /// figures on so digit columns align (KES amounts, ESK-Ids, ticket
  /// codes). Use this instead of the ambient body/display font any time
  /// the text is a number a user will double-check against cash in hand.
  static TextStyle mono({
    double fontSize = 15,
    FontWeight fontWeight = FontWeight.w500,
    Color? color,
    double? height,
  }) => TextStyle(
    fontFamily: EsokoFonts.mono,
    fontSize: fontSize,
    fontWeight: fontWeight,
    color: color,
    height: height,
    fontFeatures: const [FontFeature.tabularFigures()],
  );
}

/// Motion tokens — ported from tokens.css's --dur-* / --ease-out so the
/// product's transitions stay consistent with web (and with the
/// prefers-reduced-motion story). Use these, never ad-hoc durations.
abstract final class EsokoMotion {
  static const fast = Duration(milliseconds: 120);
  static const medium = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 320);

  /// tokens.css --ease-out: cubic-bezier(.2,.8,.3,1).
  static const easeOut = Cubic(0.2, 0.8, 0.3, 1.0);

  /// Curve for press/enter feels — a slight overshoot spring read.
  static const spring = Curves.easeOutCubic;

  /// Skeleton shimmer sweep period. Long and calm on purpose — a fast
  /// shimmer reads as "panicking", this one as "working".
  static const shimmer = Duration(milliseconds: 1400);
}

/// Shadow + elevation tokens, ported from tokens.css's --sh-* / --e-*.
/// These give interactive/raised surfaces their "floats above the page"
/// depth while keeping dense shadows out of the brand's quiet voice.
abstract final class EsokoShadows {
  /// --sh-s: resting state for interactive cards.
  static const card = [
    BoxShadow(color: Color(0x0D0A2E4D), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0D0A2E4D), blurRadius: 14, offset: Offset(0, 4)),
  ];

  /// --sh-m: the lifted state on hover/press, or floating overlays.
  static const lifted = [
    BoxShadow(color: Color(0x1A0A2E4D), blurRadius: 28, offset: Offset(0, 8)),
  ];

  /// --sh-l: for sheets and modals that read as a distinct layer.
  static const sheet = [
    BoxShadow(color: Color(0x2E0A2E4D), blurRadius: 60, offset: Offset(0, 24)),
  ];

  /// Green primary-action glow — tokens.css .btn-p's
  /// `box-shadow: 0 2px 8px rgba(18,121,74,.25)`.
  static const action = [
    BoxShadow(color: Color(0x407A124B), blurRadius: 8, offset: Offset(0, 2)),
  ];
}
