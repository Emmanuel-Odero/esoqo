// Full-stack app tests — the real widget tree, driven through
// tester.tap/enterText via the Flutter Driver/VM-service protocol, not
// synthetic OS mouse events at a simulator window's pixel coordinates.
// See integration_test/README.md for how to run these and what backend
// they need; test/widget_test.dart's own comment has been asking for
// this file since before Money/Activity existed.
//
// These hit a real core-go over the network (no mocked ApiClient — see
// that class's own doc comment on why: it wraps Dio directly with no
// injected adapter, and the intent recorded in widget_test.dart was
// always "once core-go's domain endpoints give the app something to
// mock against", i.e. run for real). That makes them integration tests
// in the literal sense, not fast unit tests — expect seconds, not
// milliseconds, and expect them to fail if the backend is down rather
// than skip silently.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:esoko_app/core/storage/token_store.dart';
import 'package:esoko_app/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('sign-in and the four-destination shell', () {
    testWidgets(
      'signing in as a plain subject reaches Home with Home/Money/Activity/Account',
      (tester) async {
        await _bootSignedOut(tester);
        await _signIn(tester, identifier: esther.phone, pin: esther.pin);

        // The shell's four bottom-nav destinations, per home_shell.dart.
        expect(find.text('Home'), findsWidgets);
        expect(find.text('Money'), findsOneWidget);
        expect(find.text('Activity'), findsOneWidget);
        expect(find.text('Account'), findsOneWidget);

        // The six service tiles from home_hub_screen._services — Chama
        // by its renamed label, never the old "Groups".
        expect(find.text('Transport'), findsOneWidget);
        expect(find.text('Bills'), findsOneWidget);
        expect(find.text('Shopping'), findsOneWidget);
        expect(find.text('Tickets'), findsOneWidget);
        // Scrolled into view first, not asserted blind: a ListView
        // only builds elements inside its viewport plus cache extent,
        // so a tile below the fold genuinely has no element and
        // find.text correctly returns zero. That's what made the first
        // version of this test fail against a screen that was in fact
        // rendering correctly.
        await _scrollTo(tester, 'Chama');
        expect(find.text('Chama'), findsOneWidget);
        expect(find.text('Groups'), findsNothing);
      },
    );

    testWidgets('Money, Activity and Account tabs render without throwing', (
      tester,
    ) async {
      await _bootSignedOut(tester);
      await _signIn(tester, identifier: esther.phone, pin: esther.pin);

      await tester.tap(find.text('Money'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(find.text('Money'), findsWidgets);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Activity'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(find.text('Activity'), findsWidgets);
      expect(tester.takeException(), isNull);

      // The regression this guards: Points and History used to live at
      // the bottom of this exact screen (see the old profile_screen's
      // history/_pointsProvider) — they moved out to Money/Activity,
      // and neither should ever reappear here.
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(find.text('Account'), findsWidgets);
      expect(find.textContaining('points'), findsNothing);
      expect(find.text('History'), findsNothing);

      // Doors, not a scroll. Each of these opens a screen of its own;
      // the QR code and PIN form that used to be stacked inline here
      // should no longer be on this screen at all.
      expect(find.text('Your details'), findsOneWidget);
      expect(find.text('Security'), findsOneWidget);
      expect(find.text('Your payment QR'), findsNothing);
      expect(find.text('New PIN'), findsNothing);

      // Sign out sits at the bottom of the Account scroll — same
      // viewport-only element building as the Chama tile above.
      await _scrollTo(tester, 'Sign out');
      expect(find.text('Sign out'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Chama', () {
    testWidgets('the Home tile opens the renamed screen, not "Groups"', (
      tester,
    ) async {
      await _bootSignedOut(tester);
      await _signIn(tester, identifier: esther.phone, pin: esther.pin);

      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await _scrollToAndTap(tester, 'Chama');

      expect(find.text('Chama'), findsWidgets);
      expect(find.text('Groups'), findsNothing);
      expect(
        find.text('Chamas, table banking and welfare groups you belong to.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('Tickets', () {
    testWidgets('Browse and Your tickets are segments of one screen', (
      tester,
    ) async {
      await _bootSignedOut(tester);
      await _signIn(tester, identifier: esther.phone, pin: esther.pin);

      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await _scrollToAndTap(tester, 'Tickets');

      // Lands on Browse first.
      expect(find.text('Browse'), findsOneWidget);
      expect(find.text('Your tickets'), findsOneWidget);

      await tester.tap(find.text('Your tickets'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      // The segment switch never pushes a second screen — the toggle
      // itself is still on screen after switching.
      expect(find.text('Browse'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Browse'));
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
    });
  });

  group('Bills', () {
    testWidgets('the screen renders without throwing', (tester) async {
      await _bootSignedOut(tester);
      await _signIn(tester, identifier: esther.phone, pin: esther.pin);

      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bills'));
      await tester.pumpAndSettle(const Duration(seconds: 2));

      expect(find.text('Bills'), findsWidgets);
      expect(tester.takeException(), isNull);
      // The urgency-sort itself (bills_list_screen.dart's byUrgency
      // comparator) needs an account seeded with more than one Overdue
      // or Due-soon bill to observe ordering on screen — none of the
      // demo accounts in DEMO_ACCOUNTS.md currently are. Add one there
      // before asserting tile order here.
    });
  });
}

/// One seeded demo account — services/core-go/DEMO_ACCOUNTS.md is the
/// source of truth; keep this in sync with it rather than the other
/// way round.
class _DemoAccount {
  const _DemoAccount(this.phone, this.pin);
  final String phone;
  final String pin;
}

/// Demo Esther Muthoni — a plain subject, no org grants, no staff
/// duty. The right account for shell/navigation tests: nothing about
/// [HatsIconButton] or ActiveRole's institutional tints should be in
/// play here.
const esther = _DemoAccount('+254700500017', '500017');

/// Boots from a guaranteed-clean slate.
///
/// The first version of this file signed out through the UI (Account
/// tab → Sign out) when a stale session was already restored, and that
/// is exactly what broke: hours of earlier manual testing had left a
/// session in the simulator's real Keychain, and by the time the test
/// reached the Account screen that session had gone stale server-side.
/// Tapping in triggered an authenticated call, got a 401, and
/// `ApiClient.onUnauthorized` signed the app out mid-`pumpAndSettle` —
/// so the assertion right after was hunting for a "Sign out" button on
/// a screen the app had already left. Clearing [TokenStore] directly
/// sidesteps the whole race: every test starts from the same state
/// regardless of what an earlier run or hours of manual poking left
/// behind, and it costs one extra sign-in round-trip per test rather
/// than a UI flow that can itself fail for reasons under test.
Future<void> _bootSignedOut(WidgetTester tester) async {
  await TokenStore.instance.clear();
  await tester.pumpWidget(const ProviderScope(child: EsokoApp()));
  await tester.pumpAndSettle(const Duration(seconds: 3));
  expect(
    _atSignIn(tester),
    isTrue,
    reason: 'expected the sign-in screen after clearing the session',
  );
}

/// True once the sign-in screen's own fields are on screen — checked by
/// the PIN field's hint rather than the headline, since "Sign in" also
/// appears on the sign-in button once signed out.
bool _atSignIn(WidgetTester tester) =>
    find.byType(TextField).evaluate().length >= 2 &&
    find.text('Sign in with a code instead').evaluate().isNotEmpty;

Future<void> _signIn(
  WidgetTester tester, {
  required String identifier,
  required String pin,
}) async {
  final fields = find.byType(TextField);
  expect(fields, findsNWidgets(2), reason: 'identifier + PIN fields');
  await tester.enterText(fields.at(0), identifier);
  await tester.enterText(fields.at(1), pin);
  await tester.pumpAndSettle();

  await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
  // Sign-in round-trips to core-go and the router redirects once
  // AuthController flips to AuthSignedIn — longer settle budget than
  // a pure-local navigation gets.
  await tester.pumpAndSettle(const Duration(seconds: 5));

  expect(
    _atSignIn(tester),
    isFalse,
    reason: 'still on the sign-in screen — check the backend is reachable '
        'and $identifier/$pin matches DEMO_ACCOUNTS.md',
  );
}

/// Scrolls [text] into view on the home hub's list and taps it.
///
/// [WidgetTester.dragUntilVisible] only guarantees the target
/// intersects the scrollable's *viewport* — it says nothing about
/// whether the FAB/bottom-nav chrome sitting on top of that viewport
/// (painted at a screen-fixed position by the Scaffold, outside the
/// scrollable entirely) is covering it. A tile that stops right at the
/// list's own bottom padding can still hit-test against the FAB
/// instead of itself — this is the on-device bug home_hub_screen.dart's
/// padding fix (the `EsokoSpacing.s9 + EsokoSpacing.s6` bottom inset)
/// addressed for a person scrolling by hand; `dragUntilVisible`'s
/// "any part on screen" definition of visible doesn't get the benefit
/// of that fix, so this nudges further once the naive scroll stops.
/// Brings [text] into the viewport so it has an element to find.
///
/// A `ListView` only builds elements inside its viewport plus cache
/// extent, so `find.text` on something below the fold returns zero
/// even when the screen is rendering perfectly — which is exactly how
/// the first version of these tests "failed" against a correct Home
/// and a correct Account. Asserting on off-screen content means
/// scrolling to it first, always.
///
/// No-op when the target is already on screen, so it's safe to call
/// defensively.
Future<void> _scrollTo(WidgetTester tester, String text) async {
  if (find.text(text).evaluate().isNotEmpty) return;
  await tester.dragUntilVisible(
    find.text(text),
    find.byType(Scrollable).first,
    const Offset(0, -120),
  );
  await tester.pumpAndSettle();
}

Future<void> _scrollToAndTap(WidgetTester tester, String text) async {
  await _scrollTo(tester, text);

  // dragUntilVisible only guarantees the target intersects the
  // scrollable's *viewport*. It says nothing about the FAB and
  // bottom-nav chrome painted on top of that viewport at a
  // screen-fixed position, outside the scrollable entirely — a tile
  // that stops inside that band still hit-tests against the FAB. The
  // bottom ~140pt of an iPhone-class screen is that chrome.
  if (find.text(text).evaluate().isNotEmpty &&
      tester.getCenter(find.text(text)).dy > 700) {
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -120));
    await tester.pumpAndSettle();
  }

  await tester.tap(find.text(text));
  await tester.pumpAndSettle(const Duration(seconds: 2));
}
