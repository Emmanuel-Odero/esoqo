import 'package:flutter/material.dart';
import 'esoko_tokens.dart';

/// Light/dark ThemeData built from [EsokoColors] — green as the primary
/// action colour ("you and yours"), matching the web apps' semantic rule
/// rather than an arbitrary Material seed colour.
abstract final class EsokoTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: EsokoColors.green,
      brightness: Brightness.light,
      primary: EsokoColors.green,
      secondary: EsokoColors.blue,
      error: EsokoColors.red,
      surface: Colors.white,
    );
    return _base(scheme).copyWith(
      scaffoldBackgroundColor: EsokoColors.paper,
      appBarTheme: AppBarTheme(
        backgroundColor: EsokoColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: _headline(const TextStyle(color: Colors.white, fontSize: 19)),
      ),
    );
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: EsokoColors.green2,
      brightness: Brightness.dark,
      primary: EsokoColors.green2,
      secondary: EsokoColors.blue2,
      error: EsokoColors.red,
      surface: EsokoColors.darkSurface2,
    );
    return _base(scheme).copyWith(
      scaffoldBackgroundColor: EsokoColors.darkSurface,
      appBarTheme: AppBarTheme(
        backgroundColor: EsokoColors.darkSurface,
        foregroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: _headline(const TextStyle(color: Colors.white, fontSize: 19)),
      ),
    );
  }

  /// tokens.css's h1/h2/h3 rule (see EsokoTypography) applied to one
  /// TextStyle — bold, tightened proportionally to its own size.
  static TextStyle _headline(TextStyle style) => style.copyWith(
        fontWeight: EsokoTypography.headlineWeight,
        height: EsokoTypography.headlineHeight,
        letterSpacing: (style.fontSize ?? 20) * EsokoTypography.headlineTrackingEm,
      );

  static ThemeData _base(ColorScheme scheme) {
    // Material's own colour-correct default for this scheme (dark
    // scheme → light-on-dark text, automatically) — only the
    // weight/tracking/line-height get overridden below, never the
    // colour, so dark mode doesn't end up with near-black headings on
    // a dark background.
    final baseText = ThemeData(useMaterial3: true, colorScheme: scheme).textTheme;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      // The web apps' h1/h2/h3 voice (bold, tight tracking — see
      // EsokoTypography) carried onto the handful of TextTheme levels
      // this app actually uses for a "screen title"/section heading:
      // headlineMedium/Small (EsokoSectionHeader, product/store/order
      // titles) and titleLarge/Medium (in-page sub-headings like
      // "Products", "Members"). Everything else (body text, labels)
      // stays Material's own default voice — this is deliberately
      // scoped to headings, not a whole-app typeface swap.
      textTheme: baseText.copyWith(
        headlineLarge: _headline(baseText.headlineLarge!),
        headlineMedium: _headline(baseText.headlineMedium!),
        headlineSmall: _headline(baseText.headlineSmall!),
        titleLarge: _headline(baseText.titleLarge!),
        titleMedium: _headline(baseText.titleMedium!),
      ),
      // 44px minimum target — WCAG 2.2 2.5.8, ported verbatim from
      // tokens.css's own comment ("the real user is standing in a
      // market with cold hands").
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsokoRadius.md),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsokoRadius.md),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(EsokoRadius.md),
          borderSide: BorderSide(color: EsokoColors.line),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: EsokoSpacing.s4,
          vertical: EsokoSpacing.s3,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsokoRadius.lg),
          side: BorderSide(color: EsokoColors.line),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsokoRadius.sm),
        ),
      ),
    );
  }
}
