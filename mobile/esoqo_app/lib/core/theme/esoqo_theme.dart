import 'package:flutter/material.dart';

import 'esoqo_tokens.dart';

/// Light/dark ThemeData built from [EsoqoColors] — green as the primary
/// action colour ("you and yours"), matching the web apps' semantic rule
/// rather than an arbitrary Material seed colour.
abstract final class EsoqoTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: EsoqoColors.green,
      brightness: Brightness.light,
      primary: EsoqoColors.green,
      secondary: EsoqoColors.blue,
      error: EsoqoColors.red,
      surface: Colors.white,
      // Brand ink, not Material's seed-derived near-black. Everything
      // that isn't explicitly styled — icons, list tiles, dialog copy,
      // disabled states — reads its colour from here, so overriding the
      // scheme (and not only the TextTheme) is what keeps a stray
      // widget from re-introducing the off-brand black.
      onSurface: EsoqoColors.text,
      onSurfaceVariant: EsoqoColors.text2,
    );
    return _base(scheme).copyWith(
      scaffoldBackgroundColor: EsoqoColors.paper,
      appBarTheme: AppBarTheme(
        backgroundColor: EsoqoColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 4,
        titleTextStyle: _headline(
          const TextStyle(
            color: Colors.white,
            fontSize: EsoqoTypeScale.cardTitle,
            fontFamily: EsoqoFonts.display,
          ),
        ),
      ),
    );
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: EsoqoColors.green2,
      brightness: Brightness.dark,
      primary: EsoqoColors.green2,
      secondary: EsoqoColors.blue2,
      error: EsoqoColors.red,
      surface: EsoqoColors.darkSurface2,
      onSurface: EsoqoColors.textOnDark,
      onSurfaceVariant: EsoqoColors.textOnDark2,
    );
    return _base(scheme).copyWith(
      scaffoldBackgroundColor: EsoqoColors.darkSurface,
      appBarTheme: AppBarTheme(
        backgroundColor: EsoqoColors.darkSurface,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 4,
        titleTextStyle: _headline(
          const TextStyle(
            color: Colors.white,
            fontSize: EsoqoTypeScale.cardTitle,
            fontFamily: EsoqoFonts.display,
          ),
        ),
      ),
    );
  }

  /// tokens.css's h1/h2/h3 rule (see EsoqoTypography) applied to one
  /// TextStyle — bold, tightened proportionally to its own size.
  static TextStyle _headline(TextStyle style) => style.copyWith(
    fontWeight: EsoqoTypography.headlineWeight,
    height: EsoqoTypography.headlineHeight,
    letterSpacing: (style.fontSize ?? 20) * EsoqoTypography.headlineTrackingEm,
  );

  /// Display voice — Outfit, headline weight/tracking/line-height.
  static TextStyle _display(double size, Color ink, {FontWeight? weight}) =>
      _headline(
        TextStyle(
          fontFamily: EsoqoFonts.display,
          fontSize: size,
          color: ink,
        ),
      ).copyWith(fontWeight: weight);

  /// Reading voice — IBM Plex Sans, generous line-height, no tracking.
  static TextStyle _body(
    double size,
    Color ink, {
    FontWeight weight = FontWeight.w400,
    double? height,
  }) => TextStyle(
    fontFamily: EsoqoFonts.body,
    fontSize: size,
    fontWeight: weight,
    color: ink,
    height: height ?? EsoqoTypography.bodyHeight,
  );

  /// UI-furniture voice — body face, w600, slight positive tracking.
  static TextStyle _label(double size, Color ink) => TextStyle(
    fontFamily: EsoqoFonts.body,
    fontSize: size,
    fontWeight: EsoqoTypography.labelWeight,
    color: ink,
    height: 1.2,
    letterSpacing: size * EsoqoTypography.labelTrackingEm,
  );

  /// The app's whole type ramp, built from [EsoqoTypeScale] rather than
  /// inherited from Material.
  ///
  /// This used to be `ThemeData(...).textTheme` with five levels
  /// re-fonted on top. That left every *colour* — and every size and
  /// line-height — at Material's seed-derived defaults, so body copy
  /// rendered in a near-black with an olive cast (the green seed's
  /// `onSurface`) against navy chrome, and `bodySmall` (which half the
  /// screens read as their `muted` colour) came out an olive grey. Both
  /// are now brand ink, and the sizes come from the scale.
  static TextTheme _textTheme(bool isDark) {
    final ink = isDark ? EsoqoColors.textOnDark : EsoqoColors.text;
    final muted = isDark ? EsoqoColors.textOnDark2 : EsoqoColors.text2;
    return TextTheme(
      // Display + headline: a screen or a block is being named.
      displayLarge: _display(EsoqoTypeScale.hero + 6, ink),
      displayMedium: _display(EsoqoTypeScale.hero, ink),
      displaySmall: _display(EsoqoTypeScale.pageTitle, ink),
      headlineLarge: _display(EsoqoTypeScale.pageTitle, ink),
      headlineMedium: _display(EsoqoTypeScale.sectionTitle, ink),
      headlineSmall: _display(EsoqoTypeScale.cardTitle, ink),
      // Titles: an item is being named. h3 on web is w700, not w800 —
      // at these sizes w800 reads as shouting, which is why so many
      // card titles in this app looked heavier than the page title
      // above them.
      titleLarge: _display(EsoqoTypeScale.subTitle, ink, weight: FontWeight.w700),
      titleMedium: _display(
        EsoqoTypeScale.label + 1,
        ink,
        weight: FontWeight.w700,
      ),
      titleSmall: _display(
        EsoqoTypeScale.labelSmall + 1,
        ink,
        weight: FontWeight.w600,
      ),
      // Reading voice.
      bodyLarge: _body(EsoqoTypeScale.bodyLead, ink),
      bodyMedium: _body(EsoqoTypeScale.body, ink),
      bodySmall: _body(
        EsoqoTypeScale.meta,
        muted,
        height: EsoqoTypography.metaHeight,
      ),
      // UI furniture. labelLarge is button text — Material's default
      // tracking (.1) is wide enough to look like a different product
      // next to the body face, so it gets the label treatment too.
      labelLarge: _label(EsoqoTypeScale.label, ink),
      labelMedium: _label(EsoqoTypeScale.labelSmall, muted),
      labelSmall: _label(EsoqoTypeScale.micro, muted),
    );
  }

  static ThemeData _base(ColorScheme scheme) {
    final isDark = scheme.brightness == Brightness.dark;
    final baseText = _textTheme(isDark);
    final mutedInk = isDark ? EsoqoColors.textOnDark2 : EsoqoColors.text2;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      // Default voice is the body typeface (web's --font-body, IBM Plex
      // Sans); the display typeface (Outfit) comes back for headings
      // and titles inside _textTheme, matching web's three-voice split
      // instead of speaking one face everywhere.
      fontFamily: EsoqoFonts.body,
      textTheme: baseText,
      // A bare `Text` with no style — and there are plenty — falls back
      // to DefaultTextStyle, not to bodyMedium, on some surfaces
      // (notably inside Material widgets that build their own
      // DefaultTextStyle). Pinning it to bodyMedium keeps those in the
      // same ink and line-height as everything else.
      primaryTextTheme: baseText,
      // Selection/cursor follow the brand's primary rather than
      // Material's seed-derived tint.
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: scheme.primary,
        selectionColor: scheme.primary.withValues(alpha: 0.24),
        selectionHandleColor: scheme.primary,
      ),
      // Placeholder/label/helper/error copy inside fields used to
      // inherit Material's defaults, so a hint sat in a different grey
      // from every other piece of secondary text on the screen.
      listTileTheme: ListTileThemeData(
        titleTextStyle: baseText.bodyLarge!.copyWith(
          fontWeight: FontWeight.w600,
          height: 1.3,
        ),
        subtitleTextStyle: baseText.bodySmall,
        leadingAndTrailingTextStyle: baseText.labelMedium,
      ),
      // Inputs: focus ring + green border, matching tokens.css's
      // `.inp:focus` (0 0 0 3px rgba(31,161,99,.13)).
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsoqoRadius.md)),
          borderSide: BorderSide(color: EsoqoColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsoqoRadius.md)),
          borderSide: BorderSide(color: EsoqoColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(EsoqoRadius.md)),
          borderSide: BorderSide(color: EsoqoColors.green, width: 1.5),
        ),
        contentPadding: EdgeInsets.symmetric(
          horizontal: EsoqoSpacing.s4,
          vertical: EsoqoSpacing.s3,
        ),
        // Field copy: what you type is body text; the label, hint,
        // helper and error around it are secondary and must agree with
        // each other. Left to Material these were four different sizes
        // in three different greys.
        labelStyle: baseText.bodyMedium!.copyWith(color: mutedInk),
        floatingLabelStyle: baseText.labelMedium!.copyWith(
          color: scheme.primary,
        ),
        hintStyle: baseText.bodyMedium!.copyWith(
          color: isDark ? EsoqoColors.textOnDark3 : EsoqoColors.text3,
        ),
        helperStyle: baseText.bodySmall,
        errorStyle: baseText.bodySmall!.copyWith(
          color: scheme.error,
          fontWeight: FontWeight.w500,
        ),
        prefixStyle: baseText.bodyMedium,
        suffixStyle: baseText.bodyMedium!.copyWith(color: mutedInk),
      ),
      // Cards: web's `.card` — light surface, 1px line, ~12px radius, a
      // soft resting shadow. EsoqoCard adds the lift on tap.
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surface,
        shadowColor: const Color(0x0A0A2E4D),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsoqoRadius.lg),
          side: BorderSide(
            color: EsoqoColors.line.withValues(
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
          shadowColor: EsoqoColors.green,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsoqoRadius.md),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsoqoRadius.md),
          ),
          elevation: 0,
          shadowColor: EsoqoColors.green,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsoqoRadius.sm),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          side: const BorderSide(color: EsoqoColors.line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EsoqoRadius.md),
          ),
        ),
      ),
      // Page transitions: a consistent, understated vertical slide+fade
      // with the brand's ease-out, replacing Material's platform-default
      // pop so navigation feels intentional without being flashy.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: _EsoqoPageTransitionsBuilder(),
          TargetPlatform.iOS: _EsoqoPageTransitionsBuilder(),
          TargetPlatform.macOS: _EsoqoPageTransitionsBuilder(),
          TargetPlatform.windows: _EsoqoPageTransitionsBuilder(),
          TargetPlatform.linux: _EsoqoPageTransitionsBuilder(),
        },
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsoqoRadius.sm),
        ),
        backgroundColor: EsoqoColors.navy,
        contentTextStyle: baseText.bodyMedium!.copyWith(
          color: Colors.white,
          height: 1.35,
        ),
        actionTextColor: EsoqoColors.green2,
      ),
      // Dialogs and sheets used to inherit Material's title/content
      // pair: a 24px Outfit-less title over near-black content. They're
      // the same two voices as everywhere else.
      dialogTheme: DialogThemeData(
        titleTextStyle: baseText.headlineSmall,
        contentTextStyle: baseText.bodyMedium,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsoqoRadius.lg),
        ),
      ),
      // Chips are furniture, so: label voice, never the headline's
      // negative tracking (which is what made filter chips look
      // squeezed).
      chipTheme: ChipThemeData(
        labelStyle: baseText.labelMedium!.copyWith(
          color: isDark ? EsoqoColors.textOnDark : EsoqoColors.text,
        ),
        secondaryLabelStyle: baseText.labelMedium,
        side: BorderSide(
          color: EsoqoColors.line.withValues(alpha: isDark ? 0.5 : 1.0),
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EsoqoRadius.pill),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        textStyle: baseText.bodySmall!.copyWith(color: Colors.white),
        decoration: BoxDecoration(
          color: EsoqoColors.navy,
          borderRadius: BorderRadius.circular(EsoqoRadius.sm),
        ),
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
        backgroundColor: isDark ? EsoqoColors.darkSurface2 : Colors.white,
        indicatorColor: isDark
            ? scheme.primary.withValues(alpha: 0.20)
            : EsoqoColors.greenTint,
        elevation: 0,
        height: 64,
        // Destination labels are furniture, not headings: the label
        // voice (body face, w600, faint positive tracking) instead of
        // the display face, whose negative tracking pinched five
        // 12px words into each other at the bottom of every screen.
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => baseText.labelMedium!.copyWith(
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : EsoqoTypography.labelWeight,
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : mutedInk,
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
      tabBarTheme: TabBarThemeData(
        labelColor: Colors.white,
        unselectedLabelColor: Colors.white70,
        dividerColor: Colors.transparent,
        labelStyle: _label(EsoqoTypeScale.label, Colors.white).copyWith(
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelStyle: _label(EsoqoTypeScale.label, Colors.white70),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: EsoqoColors.line,
      ),
    );
  }
}

/// Understated vertical slide+fade transition (tokens.css --ease-out) so
/// every push/pop across the app shares one brand motion instead of each
/// platform's default.
class _EsoqoPageTransitionsBuilder extends PageTransitionsBuilder {
  const _EsoqoPageTransitionsBuilder();

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
      curve: EsoqoMotion.easeOut,
      reverseCurve: EsoqoMotion.easeOut,
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
