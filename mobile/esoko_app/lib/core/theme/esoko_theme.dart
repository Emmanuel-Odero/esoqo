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
      appBarTheme: const AppBarTheme(
        backgroundColor: EsokoColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
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
      appBarTheme: const AppBarTheme(
        backgroundColor: EsokoColors.darkSurface,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
    );
  }

  static ThemeData _base(ColorScheme scheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
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
