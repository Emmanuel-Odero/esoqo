// Wear OS entry point — `flutter run -t lib/watch/main_wear.dart`.
//
// Written but UNBUILT: this machine has no Android SDK yet (see the
// mobile app's README's "Wear OS" section), so this file compiles
// against the same pubspec.yaml as lib/main.dart but has not been run.
//
// Deliberately its own independent session, not a mirror of the phone
// app's: Wear OS runs a separate installed app in its own process, and
// sharing a session across the two properly means relaying it over the
// Wearable Data Layer API (a Kotlin/native bridge Flutter doesn't give
// you for free) — a real feature, left as a follow-up once there's an
// Android toolchain here to build and test it against. Until then, the
// watch signs in on its own via OTP (a PIN pad is painful on a 1.3"
// screen; a 6-digit code read off the phone is not).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/auth/auth_controller.dart';
import '../core/auth/auth_state.dart';
import '../core/theme/esoqo_theme.dart';
import 'watch_home.dart';
import 'watch_sign_in.dart';

void main() {
  runApp(const ProviderScope(child: EsoqoWatchApp()));
}

class EsoqoWatchApp extends ConsumerWidget {
  const EsoqoWatchApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return MaterialApp(
      title: 'Esoqo',
      debugShowCheckedModeBanner: false,
      theme: EsoqoTheme.dark(), // dark by default — watch faces favour it (battery + legibility)
      home: switch (auth) {
        AuthUnknown() => const Scaffold(body: Center(child: CircularProgressIndicator())),
        AuthSignedOut() => const WatchSignIn(),
        AuthSignedIn(profile: final profile) => WatchHome(profile: profile),
      },
    );
  }
}
