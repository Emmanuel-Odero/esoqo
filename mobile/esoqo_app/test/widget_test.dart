// Smoke test — confirms the app boots to the sign-in screen without a
// stored session. Deeper flow tests belong in integration_test/ once
// core-go's domain endpoints (Phase 1) give the app something to mock
// against besides auth.
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:esoqo_app/main.dart';

void main() {
  // flutter_secure_storage talks to a platform channel with no
  // implementation in the widget-test harness — without a mock, its
  // `read()` call inside AuthController.build()'s _restore() never
  // resolves, so the app hangs on the AuthUnknown splash forever and
  // pumpAndSettle times out. Mocking it to answer "no token" is the
  // widget-test equivalent of a fresh install.
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized()
        .defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'read') return null;
      return null;
    });
  });

  tearDown(() {
    TestWidgetsFlutterBinding.ensureInitialized()
        .defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  testWidgets('boots to the sign-in screen', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: EsoqoApp()));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);
  });
}
