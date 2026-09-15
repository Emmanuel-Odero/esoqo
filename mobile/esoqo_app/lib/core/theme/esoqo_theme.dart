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
          const TextStyle(
            color: Colors.white,
            fontSize: 19,
            fontFamily: EsokoFonts.display,
          ),
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
          const TextStyle(
            color: Colors.white,
            fontSize: 19,
            fontFamily: EsokoFonts.display,
          ),
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
    final baseText = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
    ).textTheme;
    final isDark = scheme.brightness == Brightness.dark;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      // Default voice is the body typeface (web's --font-body, IBM Plex
      // Sans) — headings/titles below are overridden back to the
      // display typeface (Outfit), matching web's three-voice split
      // instead of speaking Outfit everywhere.
      fontFamily: EsokoFonts.body,
      // The web apps' h1/h2/h3 voice (bold, tight tracking, display
      // typeface — see EsokoTypography) carried onto the handful of
      // TextTheme levels this app actually uses for a "screen
      // title"/section heading: headlineMedium/Small
      // (EsokoSectionHeader, product/store/order titles) and
      // titleLarge/Medium (in-page sub-headings like "Products",
      // "Members"). Every other level (body*, label*) stays on the body
      // typeface set by fontFamily above.
      textTheme: baseText.copyWith(
        headlineLarge: _headline(
          baseText.headlineLarge!.copyWith(fontFamily: EsokoFonts.display),
        ),
        headlineMedium: _headline(
          baseText.headlineMedium!.copyWith(fontFamily: EsokoFonts.display),
        ),
        headlineSmall: _headline(
          baseText.headlineSmall!.copyWith(fontFamily: EsokoFonts.display),
        ),
        titleLarge: _headline(
          baseText.titleLarge!.copyWith(fontFamily: EsokoFonts.display),
        ),
        titleMedium: _headline(
          baseText.titleMedium!.copyWith(fontFamily: EsokoFonts.display),
        ),
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
          side: BorderSide(
            color: EsokoColors.line.withValues(
              alpha: scheme.brightness == Brightness.dark ? 0.5 : 1.0,
            ),
          ),
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
      // Every value here reads from `scheme`/`isDark`, not a fixed hex —
      // this bar is the root shell's bottom nav (home_shell.dart), on
      // screen for the whole app. It used to hardcode a white
      // background + light-tuned label colours regardless of
      // brightness, so dark mode got a stark white bar glued to the
      // bottom of an otherwise dark screen — the same "background-blind
      // colour" bug as the amber notice/empty-state fixes, just never
      // caught because dark() never overrode this block.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? EsokoColors.darkSurface2 : Colors.white,
        indicatorColor: isDark
            ? scheme.primary.withValues(alpha: 0.20)
            : EsokoColors.greenTint,
        elevation: 0,
        height: 64,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontFamily: EsokoFonts.display,
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : baseText.bodySmall?.color,
          ),
        ),
      ),
      // No screen uses a TabBar today, but nothing themed it either —
      // an unstyled Material TabBar defaults its unselected label to a
      // colour computed for a *light* surface, which goes nearly
      // invisible the moment it sits under this app's always-dark
      // AppBar (navy in light mode, darkSurface in dark — see
      // appBarTheme above, overridden per-brightness in light()/dark()
      // but always dark either way). Themed now so the first screen
      // that adds tabs doesn't inherit that silently.
      tabBarTheme: const TabBarThemeData(
        labelColor: Colors.white,
        unselectedLabelColor: Colors.white70,
        dividerColor: Colors.transparent,
        labelStyle: TextStyle(
          fontFamily: EsokoFonts.display,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelStyle: TextStyle(
          fontFamily: EsokoFonts.display,
          fontWeight: FontWeight.w500,
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
        position: Tween<Offset>(
          begin: const Offset(0, 0.03),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
