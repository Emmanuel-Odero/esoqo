import 'package:flutter/services.dart';

/// One-line haptic accents for the design system's press moments —
/// [EsoqoCard] taps and [EsoqoButton] presses call these so
/// screens never reach for `HapticFeedback` directly and every tap
/// feels the same weight across the app.
///
/// The single [enabled] switch exists for widget tests (haptics throw
/// outside a platform channel host) and for anyone who wants a global
/// off-ramp later; production code leaves it on.
abstract final class EsoqoHaptics {
  static bool enabled = true;

  /// Light tick for selecting/navigating (card taps, toggles).
  static void tap() {
    if (enabled) HapticFeedback.selectionClick();
  }

  /// Slightly heavier knock for committing (primary buttons).
  static void confirm() {
    if (enabled) HapticFeedback.lightImpact();
  }

  /// A deliberately heavier knock before something destructive.
  ///
  /// Distinct from [confirm] on purpose: the moment before "End duty" or
  /// "Cancel this parcel" should not feel identical to the moment before
  /// "Pay". A different weight is the cheapest possible cue that the
  /// next tap matters more, and it arrives before the dialog does.
  static void warn() {
    if (enabled) HapticFeedback.mediumImpact();
  }
}
