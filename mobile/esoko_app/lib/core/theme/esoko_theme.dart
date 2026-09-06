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
        scrolledUnderElevation: 4,
        titleTextStyle: _headline(
          const TextStyle(color: Colors.white, fontSize: 19, fontFamily: EsokoFonts.display),
        ),
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
        scrolledUnderElevation: 4,
        titleTextStyle: _headline(
          const TextStyle(color: Colors.white, fontSize: 19, fontFamily: EsokoFonts.display),
        ),
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
      // The whole app speaks Outfit — web's --font-display — so
      // headings and body share the brand voice.
      fontFamily: EsokoFonts.display,
      // The web apps' h1/h2/h3 voice (bold, tight tracking — see
      // EsokoTypography) carried onto the handful of TextTheme levels
      // this app actually uses for a "screen title"/section heading:
      // headlineMedium/Small (EsokoSectionHeader, product/store/order
      // titles) and titleLarge/Medium (in-page sub-headings like
      // "Products", "Members").
      textTheme: baseText.copyWith(
        headlineLarge: _headline(baseText.headlineLarge!),
        headlineMedium: _headline(baseText.headlineMedium!),
        headlineSmall: _headline(baseText.headlineSmall!),
        titleLarge: _headline(baseText.titleLarge!),
        titleMedium: _headline(baseText.titleMedium!),
      ),
      // Inputs: focus ring + green border, matching tokens.css's
      // `.inp:focus` (0 0 0 3px rgba(31,161,99,.13)).
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsokoRadius.md)),
          borderSide: BorderSide(color: EsokoColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsokoRadius.md)),
          borderSide: BorderSide(color: EsokoColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsokoRadius.md)),
          borderSide: BorderSide(color: EsokoColors.green, width: 1.5),
        ),
        contentPadding: EdgeInsets.symmetric(
          horizontal: EsokoSpacing.s4,
          vertical: EsokoSpacing.s3,
        ),
      ),
      // Cards: web's `.card` — light surface, 1px line, ~12px radius, a
      // soft resting shadow. EsokoCard adds the lift on tap.
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surface,
        shadowColor: const Color(0x0A0A2E4D),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsokoRadius.lg),
          side: BorderSide(color: EsokoColors.line.withValues(alpha: scheme.brightness == Brightness.dark ? 0.5 : 1.0)),
        ),
      ),
      // Buttons: 44-46px min, 8-10px radius, a scale-down on press and a
      // green glow — tokens.css .btn-p.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          elevation: 0,
          shadowColor: EsokoColors.green,
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
          elevation: 0,
          shadowColor: EsokoColors.green,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsokoRadius.sm),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          side: const BorderSide(color: EsokoColors.line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsokoRadius.md),
          ),
        ),
      ),
      // Page transitions: a consistent, understated vertical slide+fade
      // with the brand's ease-out, replacing Material's platform-default
      // pop so navigation feels intentional without being flashy.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: _EsokoPageTransitionsBuilder(),
          TargetPlatform.iOS: _EsokoPageTransitionsBuilder(),
          TargetPlatform.macOS: _EsokoPageTransitionsBuilder(),
          TargetPlatform.windows: _EsokoPageTransitionsBuilder(),
          TargetPlatform.linux: _EsokoPageTransitionsBuilder(),
        },
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsokoRadius.sm),
        ),
        backgroundColor: EsokoColors.navy,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: EsokoColors.greenTint,
        elevation: 0,
        height: 64,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontFamily: EsokoFonts.display,
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? EsokoColors.green
                : EsokoColors.text2,
          ),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: EsokoColors.line,
      ),
    );
  }
}

/// Understated vertical slide+fade transition (tokens.css --ease-out) so
/// every push/pop across the app shares one brand motion instead of each
/// platform's default.
class _EsokoPageTransitionsBuilder extends PageTransitionsBuilder {
  const _EsokoPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: EsokoMotion.easeOut,
      reverseCurve: EsokoMotion.easeOut,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position:
            Tween<Offset>(begin: const Offset(0, 0.03), end: Offset.zero).animate(curved),
        child: child,
      ),
    );
  }
}
