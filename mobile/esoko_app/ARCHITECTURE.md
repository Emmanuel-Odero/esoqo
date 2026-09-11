# Esoko mobile architecture

Feature-first + Riverpod. This file is the convention, not a suggestion —
every feature follows it so the app stays uniformly testable and the UI
thread stays free for rendering.

## Layout

```
lib/
  core/          # shared: api, auth, router, storage, theme, widgets
  features/<f>/  # one folder per feature (shopping, tickets, …)
    <f>_models.dart      # wire types + fromJson (data shapes live here)
    <f>_repository.dart  # endpoint + mapping owned here (the pattern)
    *_screen.dart        # presentation: watches providers, owns UI state
    *_providers.dart     # tiny FutureProviders delegating to the repository
```

`lib/features/shopping/stores_repository.dart` is the exemplar. Copy its
shape when a feature gets its polish pass.

## The three rules

1. **Screens never touch `ApiClient` or raw maps.** They `ref.watch` a
   typed provider and render. Parsing, query-string building, and error
   normalisation live in the feature repository. This is what keeps JSON
   work off the screen's critical path and gives caching a single place
   to land later.
2. **Providers are thin and `autoDispose`.** A provider names one query
   (`storesProvider`, `nearbyStoresProvider(query)`) and delegates to the
   repository. Memory for a screen is dropped when the screen is.
3. **UI state is explicit, not boolean soup.** Async lifecycle
   (loading/data/empty/error) goes through `EsokoAsyncView` /
   `EsokoSliverAsyncView`, which never wipe on-screen data on refetch.
   Multi-step flows (checkout, fare pay) use a small private `_Stage`
   enum with one widget per stage — never a bare `isLoading` flag
   driving the whole screen.

## Rendering rules (why the UI stays at 60–120fps)

- **Targeted rebuilds.** Watch providers as low in the tree as possible;
   never `ref.watch` at a scroll-view root for state that changes per
   keystroke. Search fields debounce (`EsokoSearchField(debounce: …)`).
- **Transitions, not snaps.** State changes cross-fade (`AnimatedSwitcher`
   inside the async views); list items enter staggered (`EsokoStagger`,
   capped delay); press feedback is haptic + scale (`EsokoHaptics`,
   `EsokoCard`, `EsokoLoadingButton`).
- **Reduced motion is a first-class state.** Every shared animation checks
   `MediaQuery.disableAnimationsOf` and renders its end state statically.
- **Brand motion only.** Durations/curves come from `EsokoMotion`, shadows
   from `EsokoShadows`, spacing from `EsokoSpacing` — never ad-hoc values.
- **Tablet-decent by default.** Screen bodies get `EsokoAdaptiveBody`
   (840 max-width) so phone layouts don't stretch on large windows.

## Brand identity (non-negotiable)

Colour semantics from `EsokoColors`, in lockstep with web `tokens.css`:
navy = authority · green = you and yours (primary action) · blue =
institutions · red = attention only. Outfit everywhere. If a design
needs a new colour, it goes in tokens first — never inline.
