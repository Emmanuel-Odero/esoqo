# Screen conventions

Read this before adding a new screen or a new wrapper. It exists
because of a real bug: `ParcelsHubScreen` built its own
`Scaffold(appBar: EsokoAppBar(...))` while also being reached through
`EsokoServiceScaffold`, which *already* renders a `Scaffold` + navy
`AppBar` around whatever it's given. Result: two stacked navy bars,
the title repeated, two back chevrons — visible proof a convention that
only lived in one file's doc comment doesn't survive a second author
adding a sixth destination eight months later.

## Rule 1 — a screen reached through a wrapper never builds its own app bar

`EsokoServiceScaffold` (Home hub's five-then-six service tiles) and any
future "pushed inside a chrome-providing wrapper" pattern owns the
`Scaffold` + `AppBar` for its destination. The screen it wraps:

- **May** return its own `Scaffold` — needed for a `FloatingActionButton`,
  a `bottomNavigationBar`, or `SnackBar`/`showDialog` context.
- **Must not** set that Scaffold's `appBar`. Leave it `null`.

```dart
// Correct — bar-less, wrapped by EsokoServiceScaffold from the hub tile.
return Scaffold(
  body: SafeArea(child: ...),
  floatingActionButton: ...,
);

// Wrong — a second AppBar stacks under the wrapper's.
return Scaffold(
  appBar: const EsokoAppBar(title: 'Parcels'),
  body: ...,
);
```

Before adding a screen to `home_hub_screen.dart`'s `_services` map,
grep the new screen file for `appBar:` — if it's there, delete it.

## Rule 2 — one screen, one `Scaffold`

If a screen is ever pushed both directly (`Navigator.push`) *and*
through a wrapper, it needs two variants (or a `showAppBar: bool`
constructor flag) — never a single build method that sometimes has a
bar and sometimes doesn't depending on who called it. Implicit
branching on "am I wrapped right now" is how this bug shipped in the
first place.

## Rule 3 — colour is semantic, not decorative

`EsokoColors`' own doc comment states the rule; screens routinely
don't follow it because "green" is also the Material `ColorScheme`'s
`primary`, so it's the path of least resistance for anything that
needs *a* colour:

| Colour | Means | Use it for |
|---|---|---|
| `navy` | authority | app bar, footer chrome — never a screen's own content |
| `green` | you and yours | your own record, a confirmed/verified state, your primary action button |
| `blue` | institutions | someone else's org/company/listing — anything that belongs to an org, not to the signed-in person |
| `red` | attention only | errors, suspended/frozen states, safety notices — never a passive label |

Before reaching for `scheme.primary`/`EsokoColors.green` by default, ask
whose thing this is. A store/ticket-org/fleet-company's own profile
header, an "Acting as" org context, a staff roster row — all
**institutions**, not **yours**, even when the signed-in person owns
that company. Reserve green for the action the person themselves is
taking (pay, contribute, confirm, sign), not for the surface they're
looking at.

## Rule 4 — never put an unconstrained button in `ListTile.trailing`

`ListTile` (and `EsokoListTile`, which wraps it) cannot size a
`FilledButton`/`OutlinedButton`/`TextButton` in `trailing` once the
title/subtitle get long enough — it throws "Trailing widget consumes
the entire tile width" at layout time. This is not a crash you'll
notice: it's a `performLayout()` assertion caught by the rendering
library, which renders as **a silently blank tile** (or a blank
screen, if it's the only tile) with no red-screen, no stack trace
visible in the UI — it only shows up in the `flutter run` console. This
has shipped twice (`org_duty_switcher_screen.dart`'s grant tiles,
`parcels_hub_screen.dart`'s "Deliver" button) before being caught, so:

- **Prefer** relying on `onTap` for the action and using `trailing`
  only for a small, intrinsically-sized status indicator (an
  `EsokoStatusPill`, an `Icon`, nothing) — this was the actual fix both
  times, since the button was always redundant with `onTap` anyway.
- If a `trailing` button is genuinely necessary (no suitable `onTap`),
  wrap it in `SizedBox(width: <fixed>, child: ...)` so `ListTile` never
  has to ask the button its intrinsic width.
- If a screen renders unexpectedly blank with no visible error, check
  the `flutter run` console for "EXCEPTION CAUGHT BY RENDERING LIBRARY"
  before assuming it's a data/provider bug — this class of layout
  assertion is silent in the UI by design.
