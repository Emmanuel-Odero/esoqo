// The lead card is the whole point of the role work: it is what makes
// switching roles *visible*. So these assert what a person actually
// sees, not just that the widget builds.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:esoqo_app/core/auth/active_role.dart';
import 'package:esoqo_app/core/theme/esoqo_theme.dart';
import 'package:esoqo_app/core/theme/esoqo_tokens.dart';
import 'package:esoqo_app/core/widgets/esoqo_haptics.dart';
import 'package:esoqo_app/core/widgets/esoqo_role_lead.dart';

Future<void> _pump(
  WidgetTester tester,
  ActiveRole role, {
  String? detail,
  String? primaryLabel,
  VoidCallback? onPrimary,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: EsoqoTheme.light(),
      home: Scaffold(
        body: EsoqoRoleLead(
          role: role,
          displayName: 'Wanjiku',
          esoqoId: 'ESK-4821-KE',
          detail: detail,
          primaryLabel: primaryLabel,
          onPrimary: onPrimary,
        ),
      ),
    ),
  );
}

/// Pulls the gradient's first colour off the card, which is how the
/// role is signalled before any word is read.
Color _leadColour(WidgetTester tester) {
  final container = tester.widget<Container>(
    find
        .descendant(
          of: find.byType(EsoqoRoleLead),
          matching: find.byType(Container),
        )
        .first,
  );
  final decoration = container.decoration! as BoxDecoration;
  return (decoration.gradient! as LinearGradient).colors.first;
}

void main() {
  setUpAll(() => EsoqoHaptics.enabled = false);

  testWidgets('personal greets by name and shows the Esoqo id', (tester) async {
    await _pump(
      tester,
      const ActiveRole(role: EsoqoRole.personal),
    );
    expect(find.text('Hello,'), findsOneWidget);
    expect(find.text('Wanjiku'), findsOneWidget);
    expect(find.text('ESK-4821-KE'), findsOneWidget);
    expect(_leadColour(tester), EsoqoColors.navy);
  });

  testWidgets('an org role says what you are acting as, not your name',
      (tester) async {
    await _pump(
      tester,
      const ActiveRole(role: EsoqoRole.crew, orgName: 'Super Metro'),
    );
    expect(find.text('Acting as'), findsOneWidget);
    expect(find.text('Super Metro'), findsOneWidget);
    // The person's own name and id belong to the personal surface.
    expect(find.text('Wanjiku'), findsNothing);
    expect(find.text('ESK-4821-KE'), findsNothing);
  });

  testWidgets('institutional roles are blue, per Rule 3', (tester) async {
    for (final role in [EsoqoRole.crew, EsoqoRole.scanner, EsoqoRole.manager]) {
      await _pump(tester, ActiveRole(role: role, orgName: 'Super Metro'));
      expect(
        _leadColour(tester),
        EsoqoColors.blue,
        reason: '$role acts for an institution, so it must read blue',
      );
    }
  });

  testWidgets('a courier is amber — carrying, not representing',
      (tester) async {
    await _pump(
      tester,
      const ActiveRole(role: EsoqoRole.courier, heldParcels: 3),
    );
    expect(_leadColour(tester), EsoqoColors.amber);
  });

  testWidgets('carrying cash is stated on the card, before any tap',
      (tester) async {
    await _pump(
      tester,
      const ActiveRole(
        role: EsoqoRole.courier,
        heldParcels: 3,
        holdingCash: true,
      ),
      detail: '3 in hand · KES 4,200 to hand in',
    );
    expect(find.textContaining('KES 4,200'), findsOneWidget);
    expect(find.textContaining('cash'), findsOneWidget);
  });

  testWidgets('the primary action fires', (tester) async {
    var tapped = false;
    await _pump(
      tester,
      const ActiveRole(role: EsoqoRole.courier, heldParcels: 2),
      primaryLabel: 'My parcels',
      onPrimary: () => tapped = true,
    );
    await tester.tap(find.text('My parcels'));
    expect(tapped, isTrue);
  });

  testWidgets('no action means no button rather than a dead one',
      (tester) async {
    await _pump(tester, const ActiveRole(role: EsoqoRole.personal));
    expect(find.byType(InkWell), findsNothing);
  });

  // The card is the first thing on the screen, so it is the first thing
  // a screen reader hits. It must announce the role as one statement
  // rather than as loose fragments.
  testWidgets('announces the role as a single labelled region',
      (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(
      tester,
      const ActiveRole(role: EsoqoRole.crew, orgName: 'Super Metro'),
    );
    expect(
      find.bySemanticsLabel(
        RegExp(r'Super Metro\. Collecting fares'),
      ),
      findsOneWidget,
    );
    handle.dispose();
  });

  // Text scaling is the accessibility failure most likely to hit this
  // product's users: outdoors, one-handed, often presbyopic. The card
  // must not overflow at 200%.
  testWidgets('survives 200% text scale without overflowing',
      (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: EsoqoTheme.light(),
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: Scaffold(
            body: EsoqoRoleLead(
              role: const ActiveRole(
                role: EsoqoRole.courier,
                heldParcels: 3,
                holdingCash: true,
              ),
              displayName: 'Wanjiku',
              detail: '3 in hand · KES 4,200 to hand in',
              primaryLabel: 'My parcels',
              onPrimary: () {},
              secondaryLabel: 'Scan',
              onSecondary: () {},
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
