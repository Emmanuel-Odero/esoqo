// The ranking that decides what every person sees when they open the
// app. It is a pure function, so it is tested directly — and it needs
// testing, because "which role wins" is a product decision that would
// otherwise live only in the order of a few if-statements.
import 'package:flutter_test/flutter_test.dart';

import 'package:esoqo_app/core/auth/active_role.dart';
import 'package:esoqo_app/core/auth/auth_state.dart';
import 'package:esoqo_app/core/auth/org_context_state.dart';

AuthState _signedIn({List<String> capabilities = const []}) => AuthSignedIn(
      EsoqoProfile(
        partyId: 'p1',
        officialName: 'Wanjiku',
        capabilities: capabilities,
      ),
    );

OrgContextState _duty(String role, {String org = 'Super Metro'}) =>
    OrgContextState(
      active: ActiveOrgContext(orgId: 'o1', orgName: org, role: role),
    );

void main() {
  group('the default', () {
    test('a signed-in person with nothing on is personal', () {
      final r = resolveActiveRole(
        auth: _signedIn(),
        orgContext: const OrgContextState(),
      );
      expect(r.role, EsoqoRole.personal);
      expect(r.isPersonal, isTrue);
      expect(r.isInstitutional, isFalse);
      expect(r.orgName, isNull);
    });

    test('a signed-out person is personal, not a crash', () {
      final r = resolveActiveRole(
        auth: const AuthSignedOut(),
        orgContext: const OrgContextState(),
      );
      expect(r.role, EsoqoRole.personal);
    });
  });

  group('org grants map to surfaces', () {
    test('CREW', () {
      final r = resolveActiveRole(
        auth: _signedIn(),
        orgContext: _duty('CREW'),
      );
      expect(r.role, EsoqoRole.crew);
      expect(r.orgName, 'Super Metro');
      expect(r.title, 'Super Metro');
      expect(r.isInstitutional, isTrue);
    });

    test('SCANNER', () {
      expect(
        resolveActiveRole(auth: _signedIn(), orgContext: _duty('SCANNER')).role,
        EsoqoRole.scanner,
      );
    });

    test('MANAGER and ADMIN share the company surface', () {
      for (final grant in ['MANAGER', 'ADMIN']) {
        expect(
          resolveActiveRole(auth: _signedIn(), orgContext: _duty(grant)).role,
          EsoqoRole.manager,
          reason: '$grant should land on the company surface',
        );
      }
    });

    // The failure mode this guards: a grant string the app does not
    // recognise silently dropping someone back to Personal, which looks
    // exactly like the switch not working.
    test('an unrecognised grant still shows an org surface', () {
      final r = resolveActiveRole(
        auth: _signedIn(),
        orgContext: _duty('SOMETHING_NEW'),
      );
      expect(r.isPersonal, isFalse);
      expect(r.isInstitutional, isTrue);
      expect(r.orgName, 'Super Metro');
    });
  });

  group('crew without an org context', () {
    test('an unrestricted fare.verify capability is crew', () {
      final r = resolveActiveRole(
        auth: _signedIn(capabilities: ['fare.verify']),
        orgContext: const OrgContextState(),
      );
      expect(r.role, EsoqoRole.crew);
    });

    // scan_access.dart's rule: owner-scoped grants are not crew. Every
    // ordinary subject holds `:own` capabilities, so treating them as
    // crew would put the entire user base on the duty surface.
    test('an owner-scoped capability is NOT crew', () {
      final r = resolveActiveRole(
        auth: _signedIn(capabilities: ['fare.read:own', 'fleet.write:own']),
        orgContext: const OrgContextState(),
      );
      expect(r.role, EsoqoRole.personal);
    });
  });

  group('custody outranks everything', () {
    test('holding parcels beats a manager grant', () {
      final r = resolveActiveRole(
        auth: _signedIn(),
        orgContext: _duty('MANAGER'),
        heldParcels: 3,
      );
      expect(r.role, EsoqoRole.courier);
      expect(r.heldParcels, 3);
      // The org is still named — the person has not stopped being a
      // manager, the app has just decided what to lead with.
      expect(r.orgName, 'Super Metro');
    });

    test('holding parcels beats crew duty', () {
      expect(
        resolveActiveRole(
          auth: _signedIn(capabilities: ['fare.verify']),
          orgContext: _duty('CREW'),
          heldParcels: 1,
        ).role,
        EsoqoRole.courier,
      );
    });

    test('zero parcels does not make someone a courier', () {
      expect(
        resolveActiveRole(
          auth: _signedIn(),
          orgContext: const OrgContextState(),
          heldParcels: 0,
        ).role,
        EsoqoRole.personal,
      );
    });
  });

  group('carrying somebody else’s cash is said out loud', () {
    test('the courier line names the cash when there is any', () {
      final withCash = resolveActiveRole(
        auth: _signedIn(),
        orgContext: const OrgContextState(),
        heldParcels: 2,
        holdingCash: true,
      );
      expect(withCash.holdingCash, isTrue);
      expect(withCash.because, contains('cash'));

      final without = resolveActiveRole(
        auth: _signedIn(),
        orgContext: const OrgContextState(),
        heldParcels: 2,
      );
      expect(without.because, isNot(contains('cash')));
    });
  });

  group('every role can render', () {
    test('title and because are non-empty for all of them', () {
      final cases = <ActiveRole>[
        resolveActiveRole(
            auth: _signedIn(), orgContext: const OrgContextState()),
        resolveActiveRole(
            auth: _signedIn(), orgContext: const OrgContextState(), heldParcels: 1),
        resolveActiveRole(auth: _signedIn(), orgContext: _duty('CREW')),
        resolveActiveRole(auth: _signedIn(), orgContext: _duty('SCANNER')),
        resolveActiveRole(auth: _signedIn(), orgContext: _duty('MANAGER')),
      ];
      expect(cases.map((c) => c.role).toSet().length, 5,
          reason: 'the five cases should produce five distinct roles');
      for (final c in cases) {
        expect(c.title, isNotEmpty);
        expect(c.because, isNotEmpty);
      }
    });

    // An org role with no name must still render something sensible —
    // orgName is nullable and a grant can arrive without one.
    test('an unnamed org falls back to a generic title', () {
      final r = resolveActiveRole(
        auth: _signedIn(capabilities: ['fare.verify']),
        orgContext: const OrgContextState(),
      );
      expect(r.role, EsoqoRole.crew);
      expect(r.orgName, isNull);
      expect(r.title, 'On duty');
    });
  });
}
