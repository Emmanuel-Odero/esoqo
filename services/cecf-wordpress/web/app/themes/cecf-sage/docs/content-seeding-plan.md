# CECF content seeding — research & recommendation

**Status:** decisions approved 2026-08-07 (§4); PHP has not been written
yet. `database/content/` (this theme's git-tracked seed source, moved here
from a top-level `services/cecf-wordpress/content/` on the same date since
it's cecf-sage-specific, not Bedrock-app-wide) has been populated as
groundwork; the seeder itself, the Meta Box field registration, and the
page-routing change described below are **not yet implemented**.

**IA update (2026-08-11):** the 21-page inventory in §2 below was later
consolidated to **7 pages** — Home, About, Programs, Partnerships, Impact,
Apply, Contact — by merging each dropdown group's sibling pages into one
page with in-page anchored subsections, and renaming `form` to `apply`.
§2's table is kept as-is below as a record of what was extracted from the
template; it no longer reflects the live page count or nav structure. See
`database/content/pages/_index.json` and `database/content/navigation.json`
(their `note` fields) for the current 7-page mapping and rationale. Section
`type` values, media, and the underlying copy strings are unaffected — this
was a page-boundary and navigation change only.

All paths below are relative to `web/app/themes/cecf-sage/` unless stated
otherwise.

## 1. What exists today

- `services/cecf-wordpress` is a fresh Bedrock scaffold (multisite,
  subdomain network) with the Sage theme (`cecf-sage`) already wired up as
  a pnpm workspace package. No content, no plugins beyond Bedrock's
  mu-plugins, no ACF/Meta Box/Carbon Fields, no seeder.
- `DISALLOW_FILE_MODS = true` (`config/application.php`) — by Bedrock
  convention, all plugins must be added via Composer, never through
  wp-admin. This shapes every plugin-choice decision below.
- **The theme runs on `roots/acorn` (^6.0)**, i.e. Laravel-in-WordPress —
  confirmed in `composer.json` (`"App\\": "app/"` PSR-4 autoload,
  `Roots\Acorn\ComposerScripts::postAutoloadDump`). This means the theme
  already has a real Laravel service container, and `wp acorn` is available
  as a console runner alongside `wp` itself — which is why the seeder is a
  theme-owned Acorn console command (§3.5), not a separate mu-plugin: this
  content is specific to *this theme's* rendering of *this design*, not a
  site-wide WordPress concern, so it belongs where the theme's other
  app code (`app/Providers`, `app/View`) already lives.
- The theme already registers one nav menu (`primary_navigation`) and has
  `page.blade.php` / `template-custom.blade.php` stubs, but nothing footer-
  or section-aware yet.
- The approved design, `cecf-theme-design-template.html`, is a **client-side
  single-page app**: one HTML shell, a JS hash-router (`#/about`, `#/form`,
  …), and a `window.__CECF_PAGES__` object holding all 21 pages' HTML as
  strings, swapped into `#app` on navigation. It was built as a *design
  reference*, not as the literal implementation target.

## 2. Content inventory (extracted, not invented)

**21 pages** (20 content pages + home), organised under 5 primary-nav groups
plus 2 footer-only pages (`partner`, `events`, `careers` are reachable only
via footer/cross-links, not the header dropdowns):

| Nav group | Pages |
|---|---|
| *(top-level)* | Home, About us, News & events, Contact |
| Our approach | The problem, Results |
| Impact | Impact & sustainability, Stories from the ground, Reports & publications |
| For Communities | Register your group, What you will need, Find a field officer, Registration form, Training calendar |
| Partner with us | Government & agencies, Banks & insurers, Donors & development partners, Corporate sponsorship |
| *(footer-only)* | Partner with us (hub), Events calendar, Work with us |

**18 distinct reusable section/component types** were catalogued from the
template's CSS and given a `type` in the new JSON schema (`hero`, `phead`,
`prose`, `twoColumn`, `statGrid`, `cardGrid`, `stepList`,
`requirementList`, `table`, `eventList`, `newsList`, `storyList`,
`downloadList`, `sponsorshipGrid`, `partnerList`, `ctaBand`, `callout`,
`note`) plus one special case (`registrationForm`, the 6-step wizard on the
`form` page). Full definitions: `database/content/README.md`.

**Media:**
- 8 unique bespoke brand SVG illustrations (the template repeats several of
  these byte-for-byte across 2–4 pages) — extracted once each to
  `database/content/media/illustrations/`.
- ~40 small inline icon instances, ~25 distinct icons — **not** extracted
  into seed content; recommended as theme assets (§5.4).
- 6 external Wikimedia Commons photo hot-links (+1 already-broken local
  reference) used as stand-ins for real CECF photography — **not** copied
  in; documented with licensing rationale in
  `database/content/media/photos/PLACEHOLDERS.md`.

**All real CECF copy** (mission, programme description, partner list,
pricing table, training calendar, form copy, etc.) has been transcribed
into `database/content/pages/*.json`, verbatim from the template, restructured into
the section schema above. Nothing is Lorem Ipsum. Three illustrative
"stories" on the `stories` page are flagged explicitly as **template
examples, not verified CECF testimonials** — they must not go live without
real consent per the page's own disclaimer.

## 3. Decisions needed before implementation

### 3.1 Structured-fields engine (blocks content editing without redeploying code)

| Option | Cost | Composer-installable (Bedrock-compatible) | Repeater/flexible-content in free tier | Editor GUI | Verdict |
|---|---|---|---|---|---|
| **ACF PRO** | ~US$49–149/site/yr | Only via a licensed private Composer feed (license key baked into the repo URL — awkward to keep out of git, awkward for a nonprofit budget) | N/A — paid tier is what unlocks it | Best-in-class | Recurring cost + credential-management friction; hard to justify for a nonprofit |
| **ACF (free)** | Free | Yes, on WPackagist | **No** — Repeater/Flexible Content/Gallery/Options Page are PRO-only | Good | Free tier can't model repeating sections at all — ruled out |
| **Meta Box (free core)** | Free | Yes, on WPackagist | **Yes** — clone/group fields are bundled free | Good | Best fit: free, Composer-native, has what we need |
| **Carbon Fields** | Free, open-source | Yes, `composer require htmlburger/carbon-fields` (a library, not an admin-installed plugin at all) | Yes — Complex fields free | None — code-defined only, no "Create Field Group" UI | Most Bedrock-idiomatic, but CECF's non-technical staff would need a developer for every field change |
| **Native Gutenberg blocks/patterns** | Free | N/A, core | N/A | Native editor | No structured "section type → data" model; every editor free-forms layout — highest long-term content drift risk |

**Recommendation: Meta Box (free core).** It's the only option that is
simultaneously free, Composer/WPackagist-installable (fits
`DISALLOW_FILE_MODS`), has repeater/group fields in its free tier, and gives
CECF's own staff a real admin GUI to edit content later without a developer.
The section-type JSON schema in `database/content/pages/*.json` was written so it
maps directly onto a Meta Box "Page Sections" group+clone field — no
reshaping needed if this is approved.

### 3.2 URL / routing model

The template's `#/about`-style hash routing is a client-rendered SPA
pattern: one real URL, JS swaps content, nothing exists without JavaScript,
and — critically — **search engines and screen-reader "read page" tooling
never see distinct URLs per page.** For a nonprofit whose primary channel to
government/donor/partner audiences is organic search and shared links, this
is a real cost, not a style preference.

| Option | SEO / no-JS | Browser back button, deep-linking | Matches template pixel-for-pixel | Effort |
|---|---|---|---|---|
| Keep `#/route` client router as-is | Poor (one URL for whole site) | Works, but fragile (hash router reimplemented in the theme) | Yes | Low now, high long-term (reimplementing a router in a WP theme is unusual and hard to maintain) |
| **Convert each route to a real WP page** (`/about-us`, `/the-problem`, …) | Full | Native | Visually identical; only the address bar and page-load model change | Moderate now, standard thereafter |

**Recommendation: real WP pages.** `database/content/pages/_index.json` already
proposes a `slug` per page (e.g. `about` → `/about-us`). This is a
meaningful deviation from the literal template and is exactly the kind of
call that should be confirmed with you before the seeder writes 21 `page`
posts with these slugs and permalinks.

### 3.3 Footer navigation model

The footer is 5 columns of *grouped, headed* links (not a flat menu) — WP's
native `wp_nav_menu()` doesn't represent a heading well without hacking
depth-2 items as fake headers.

| Option | Verdict |
|---|---|
| Register a second `footer_navigation` nav menu location, fake headers via unclickable top items | Works, but fragile, awkward in wp-admin's menu screen |
| **Model footer columns as structured data on a Meta Box Options page** (`site-settings` — heading + links[], matching `database/content/navigation.json`'s `footerColumns` shape already written) | Matches the shape we've already seeded; one edit screen for all footer content |

**Recommendation: Options page**, consistent with 3.1's engine choice. *(Revised
during implementation — see §4: Meta Box's free tier doesn't ship a storage
backend for this, so it's WordPress's native Settings API instead. Still an
options page; just not a Meta Box one.)*

### 3.4 Registration-form backend

The 6-step wizard's UI/UX/client validation is **already fully built** in
the template (vanilla JS, no framework dependency). The open question is
only what happens to the payload on submit.

| Option | Fit |
|---|---|
| Fluent Forms / WPForms / Contact Form 7 | Would mean re-building the already-hand-built wizard *inside* the plugin's own renderer — throws away working, tested UI for no benefit |
| **Custom `cecf_enquiry` CPT + a small REST route**, keeping the existing JS wizard and just wiring its final `fetch()` to that route | Reuses the built UI, keeps the payload in WP (visible in wp-admin, exportable), no plugin dependency, matches the Kenyan-phone-regex validation already written client-side |

**Recommendation: custom CPT + REST endpoint**, registered by the theme's
`app/Providers` alongside the seeder (they're both "small, code-defined
extensions of this theme," not general Bedrock-app concerns). `database/content/pages/form.json` already separates "copy"
(seeded) from "behaviour" (stays in the JS wizard) along this line.

### 3.5 Seeder implementation pattern

| Option | Diffable/reviewable in git | Idempotent re-runs | Fits Bedrock's "code is source of truth" | Verdict |
|---|---|---|---|---|
| WXR import (WordPress Importer) | No (XML export blob) | No | No | Ruled out |
| DB-dump migration plugin (WP Migrate DB, All-in-One WP Migration) | No | No | No | Ruled out |
| **Theme-owned Acorn console command**, `database/seeders/`, reading `database/content/*.json` | Yes | Yes (upsert by page `key`/slug, safe to re-run) | Yes | **Recommended** |

A raw WP-CLI mu-plugin (`web/app/mu-plugins/cecf-seeder/`) was the original
proposal in an earlier draft of this doc; revised per review — this content
and its seeder are cecf-sage-theme concerns, not Bedrock-app-wide ones, and
the theme already ships `roots/acorn`, which gives it a real Laravel
console kernel for free. Reaching for a mu-plugin would duplicate
infrastructure Acorn already provides and would separate the seeder from
the data it reads across a Bedrock/theme boundary for no reason.

Shape (not yet built), `web/app/themes/cecf-sage/`:
```
app/
└── Console/
    └── Commands/
        └── CecfSeedCommand.php   # `wp acorn cecf:seed {--pages} {--nav} {--media} {--force}`
                                    #   registered via app/Providers (Acorn auto-discovers
                                    #   App\Console\Commands\* the same way Laravel does)
database/
├── content/                       # (this folder — already populated)
└── seeders/                       # namespace Database\Seeders — needs a
    ├── PageSeeder.php             #   composer.json psr-4: "Database\\Seeders\\": "database/seeders/"
                                    #   (Laravel's own convention — not a blanket "Database\\": "database/")
    │                               #   reads content/pages/*.json → wp_insert_post +
    │                               #   Meta Box field values
    ├── MediaSeeder.php            # sideloads content/media/illustrations/*.svg into the
    │                               #   media library once, dedupes by filename
    ├── NavSeeder.php              # reads content/navigation.json → wp_update_nav_menu_item
    └── SettingsSeeder.php         # reads content/site-settings.json → the Options page fields
```
Run manually in dev/staging (`docker/entrypoint.sh` should **not** auto-run
it in production — content, once live-edited by CECF staff, must never be
silently overwritten by a redeploy).

### 3.6 Multisite scope

This seed is for the **main site only** (`childeldercare.foundation`) —
`donate.*` and `blog.*` are separate blogs in the network with their own
content, out of scope here. The seeder should target `get_current_blog_id()`
/ explicit `--url=` rather than iterating the network.

## 4. What's been delivered now vs. what's pending approval

**Delivered, pass 1 (content extraction):**
- `database/content/` — git-tracked seed source: `site-settings.json`,
  `navigation.json`, `pages/_index.json`, `pages/<21 files>.json`,
  8 deduped illustration SVGs, and documentation of the two deliberate
  content gaps (icons, photos).

**Approved (2026-08-07):**
1. ✅ Meta Box (free) as the structured-fields engine — §3.1
2. ✅ Converting hash-routes to real WP page slugs — §3.2
3. ✅ Options-page model for footer columns — §3.3 (revised below — native
   Settings API, not a Meta Box "settings page")
4. ✅ Custom CPT + REST for the registration form, vs. a forms plugin — §3.4
5. ✅ Gradient-fallback placeholder for un-sourced photos, not Wikimedia downloads — §3.6

**Delivered, pass 2 (seeder, fields, CPT/REST — built and verified end-to-end
in the `cecf` docker profile):**
- `app/Content/ContentRepository.php` + `SectionTypes.php` — the one place
  that knows the JSON files' shape/location and the canonical section-type
  list, so seeders and field registration both read from it instead of
  duplicating either.
- `App\Providers\CecfContentServiceProvider` — the Meta Box "Page sections"
  group+clone field group (§3.1), **revised in implementation**: site
  settings/footer columns use WordPress's native Settings API
  (`register_setting`), not a Meta Box "settings page" — Meta Box's free
  core only ships *screen-detection* for that object type (`settings_pages`
  in `inc/functions.php`); the actual storage backend lives in a separate
  "MB Settings Page" extension that isn't reliably resolvable through this
  project's Composer repositories. Native Settings API is free, built into
  WordPress, and just as real an admin surface.
- `App\Providers\CecfEnquiryServiceProvider` — the `cecf_enquiry` CPT and
  the `POST /wp-json/cecf/v1/enquiries` route, with the same required-field
  set and Kenyan-phone regex the client wizard already validates against.
  Verified: happy path (201), missing required field (422), invalid phone
  (422); `rest_url()` correctly resolves through Bedrock's `/wp/` core path.
- `database/seeders/{MediaSeeder,PageSeeder,NavigationSeeder,
  SiteSettingsSeeder,CecfSeeder}.php` — see §3.5's shape, built as specified.
  `MediaSeeder` scopes its `upload_mimes` SVG allowance to the seeder's own
  call (not a permanent site-wide filter — SVG uploads are a stored-XSS
  vector core deliberately blocks by default).
- `App\Console\Commands\CecfSeedCommand` (`wp acorn cecf:seed
  [--pages] [--nav] [--settings] [--media]`) + `CecfConsoleServiceProvider`
  registering it.
- Verified in the `cecf` docker profile: all 21 pages created at their
  approved slugs, home set as the static front page, 8 illustrations in
  the media library, the primary nav menu rebuilt with correct parent/child
  nesting, `cecf_site_settings` populated (footer columns + 47 counties),
  Meta Box's `cecf_sections` field round-trips each page's JSON exactly
  (spot-checked `about-us`: 15 sections, correct order/types), and a second
  `cecf:seed` run left every count unchanged (idempotent — no duplicates).

**Two upstream/infra bugs found and fixed during this pass (not part of the
original plan, discovered by actually running it):**
- `wpackagist-plugin/meta-box` ships without its own `vendor/autoload.php`,
  which `inc/loader.php` needs for its `MetaBox\` PSR-4 classes — version
  5.14.0's `new \MetaBox\Integrations\WPML()` call has no `class_exists`
  guard (unlike its sibling `Updater` calls) and fatals on activation.
  Pinned to `5.6.18` (predates that specific unguarded call) **and** added
  `bin/fix-meta-box-autoload.php`, wired into both `composer.json`'s
  `post-install-cmd`/`post-update-cmd` (local/CI installs) and an explicit
  `RUN` step in the Dockerfile (which uses `--no-scripts` deliberately, so
  the composer.json hooks alone don't cover Docker builds) — self-healing
  on every future `composer install`/`update`, not just a version pin that
  quietly stops working on the next `composer update`.
- The Dockerfile's runtime stage never explicitly copied
  `web/app/plugins` from the composer `vendor` build stage, and
  `.dockerignore` didn't exclude it either — so the image was silently
  copying whatever was in the *host's* local `web/app/plugins` (composer-
  installed there during this session's development) instead of a
  reproducible, composer.lock-derived copy. Fixed both: `.dockerignore`
  now excludes `web/app/plugins/*` from the build context (mirroring how
  `.gitignore` already treats it), and the Dockerfile copies it from the
  `vendor` stage like every other Composer artifact.

## 5. Pass 3 — rendering the seeded content (2026-08-07)

Approved scope: global layout (header/nav/footer) + 10 section partials
(`phead`, `prose`, `twoColumn`, `cardGrid`, `statGrid`, `ctaBand`, `note`,
`callout`, plus `linkOut`/`linkRow` as a near-zero-cost addition), CSS
ported wholesale from the design template, the full ~25-icon set extracted,
a graceful fallback for the 12 deferred section types (`table`,
`eventList`, `newsList`, `storyList`, `downloadList`, `sponsorshipGrid`,
`partnerList`, `stepList`, `requirementList`, `registrationForm`, plus
`hero` — home's only untyped section). Verified end-to-end in the `cecf`
docker profile: all 21 pages return 200 with zero PHP errors; `results`
and `careers` (fully covered by the built types) render completely;
`home`/`about` render partially with the fallback firing exactly on their
deferred sections (`hero`; `partnerList`×2 + `table`).

**New theme code**, one concern per class (mirroring pass 2's discipline):
`App\Support\Icon` (+ `<x-icon>` component), `App\Support\Nav\
CecfMenuWalker` / `CecfMobileMenuWalker` (desktop dropdown / mobile drawer
markup from the real `wp_nav_menu()` tree), `App\Support\PageUrl` (content
`key` → real permalink, one query not one per link), `App\Support\Media`
(illustration filename → seeded attachment URL), `App\Support\Markdown`
(the `**bold**`/`*italic*`/`### heading` seed content already uses), `App\
Support\ButtonStyle`, `App\View\Composers\CecfSiteSettings` and
`PageSections` (the latter the one place that decodes `cecf_sections`,
same discipline as `ContentRepository`).

**Four real bugs found by actually rendering every page, not by review**
(all fixed, all now covered by the sweep in §6):
1. **WP core's `has_children` mechanism.** `Walker::display_element()` in
   this WP version sets `$this->has_children` (a property on the walker
   instance), not `$args->has_children` as older-WP-era examples online
   assume — and even that property is only correct for whichever item
   `start_el()` is *currently* rendering, stale by the time `end_el()`
   runs for a parent (every child processed in between overwrites it). Both
   walkers now capture it per-item-ID in `start_el()` and read that back in
   `end_el()`, instead of trusting the shared property a second time.
2. **`Icon::svg()`'s width/height regex also matched `stroke-width="1.8"`**
   (contains "width=" as a substring), silently corrupting every icon's
   stroke width to whatever pixel size was requested. Fixed with a
   negative lookbehind excluding `stroke-` and tightened the replacement
   limit.
3. **`home_url()` resolved to `.../wp` on every link, sitewide** — a
   pre-existing bug in `docker/entrypoint.sh`'s first-boot install: `wp
   core multisite-install --url=` sets *both* `home` and `siteurl` to that
   one URL, which is wrong for Bedrock (core lives under `/wp`; `home`
   should be the bare domain). No `pre_option_home` filter or WP_HOME-
   constant override exists in WP core to paper over this at runtime —
   confirmed by reading `wp-includes/option.php` directly, not assumed.
   Fixed the install script to explicitly set both options correctly after
   install, and corrected the already-provisioned test database directly.
4. **Sage's stock `partials/page-header.blade.php`** (a plain `<h1>{title}
   </h1>`) was rendering above every page's own styled `phead`/`hero`
   section, which already carries the page's heading — removed the
   `@include` in `page.blade.php` rather than leave a visible duplicate
   heading on all 21 pages.

Also caught and fixed one **data-quality inconsistency** in
`database/content/pages/home.json`: its dark "How it works" `twoColumn`
nested `reverse` under `media` instead of at the section's top level like
every other page — normalized rather than special-cased in the partial.

## 6. Still open / next implementation pass

- Real photography to replace the `.ph.fallback` placeholders (`stories`,
  `government`, `careers` — see `database/content/media/photos/
  PLACEHOLDERS.md`), and the trustee/annual-report content flagged as
  TODO in `about.json`'s governance section.
- The `registrationForm` block/partial pair is copy-only (the 6-step
  wizard's markup/behaviour is still hand-built JS wired to the
  `cecf_enquiry` REST route from pass 2) — unchanged by pass 4 below.

## 7. Pass 4 — from a JSON-textarea Meta Box field to real Gutenberg blocks (2026-08-15)

**Problem this pass fixes:** every page section was one row in a Meta Box
"Page sections" clone group, and the row's entire content — heading, body
copy, every list item — lived in one `textarea` field the admin UI labelled
"Section data (JSON)". A Content Manager had to open a page's edit screen,
scroll past the normal (empty, unused) block editor, find the Meta Box panel
below it, and hand-edit a pretty-printed JSON blob to change a single word.
That's what §6's now-removed "Decomposing the 20 section types..." item was
tracking, and what this pass actually did, going further than a decompose-
in-place fix: instead of building 20 bespoke Meta Box field-group UIs (still
a panel below the real editor, still not what "content" means to a WP admin
user), every section type became a real Gutenberg block, so the block
editor itself — the screen every WordPress user already expects to build a
page in — is now the *only* editing surface, wp-admin's Custom Fields panel
is never involved, and the "Page sections" Meta Box field/panel is gone.

**Approach:**
- `App\Content\SectionFields` — one field schema per `SectionTypes` value
  (~20), read from both PHP (block registration) and JS (the editor UI),
  so a field only needs to be added/changed in one place. Field `type`
  values (`text`, `textarea`, `select`, `boolean`, `page`, `icon`,
  `illustration`, `stringList`, `rowList`, `repeater`, `group`) cover every
  shape the 20 partials already read from `$data` — see that class's
  docblock.
- `App\Providers\CecfBlocksServiceProvider` registers one `cecf/<type>`
  block per section type (`register_block_type()`, no `block.json` files —
  one PHP array per type, generated from `SectionTypes`/`SectionFields`
  rather than hand-duplicated 20 times). Every block has exactly one
  attribute, `data` (an object) — the same shape a JSON section already
  had, minus `type`. `render_callback` hands that straight to the
  **unchanged** `resources/views/partials/cecf/<type>.blade.php` partial;
  none of the 20 partials, nor `App\Support\{Markdown,PageUrl,Icon,Media,
  ButtonStyle}`, needed to change — only where `$data` comes from changed.
  Also registers a "CECF sections" block category and two starter block
  patterns (`cecf/basic-page`, `cecf/highlights-page`) so a Content
  Manager building a new page has a normal "insert a pattern" starting
  point instead of needing to know which of ~20 blocks to reach for first.
- `App\View\Composers\PageSections` now parses the page's real
  `post_content` (`parse_blocks()`), filtering for `cecf/*` blocks, instead
  of decoding the old `cecf_sections` Meta Box meta field — same
  `{type, label, data}` shape handed to `partials.content-page`, so that
  Blade file didn't need to change either.
- `database/seeders/PageSeeder.php` now writes each section as real block
  markup (`serialize_block()`) into `post_content`, instead of a Meta Box
  meta row — this is also the migration path: re-running
  `wp acorn cecf:seed --pages` rewrites the 8 live-seeded pages'
  `post_content` from `database/content/pages/*.json` straight into block
  markup. (Still not run automatically on deploy — see
  `App\Console\Commands\CecfSeedCommand`'s docblock, unchanged reasoning.)
- `App\Content\SectionTypes::blockName()`/`typeFromBlockName()` — the one
  place the `type` (camelCase) <-> block name (`cecf/kebab-case`) mapping
  lives, since both the PHP registration/seeder side and the JS side
  (`resources/js/blocks/register.jsx`, which reimplements the same
  camelCase-to-kebab-case rule to build the same block names client-side)
  need it independently and must agree byte-for-byte.
- `resources/js/blocks/register.jsx` + `fields.jsx` — no hand-written
  `edit.js` per block type. One generic field-renderer (recursive over
  `App\Content\SectionFields`'s schema, handed to the editor as
  `window.cecfSectionSchema`) builds every block's Inspector controls;
  the block's canvas area shows the real, live-styled front end via
  `<ServerSideRender>` (the same `render_callback`/Blade partial the
  public site uses), so a Content Manager sees what they're building
  while they edit fields in the sidebar — not a raw textarea, not a
  guess. Confirmed `@roots/vite-plugin`'s `wordpressPlugin()` (already in
  `vite.config.js`) externalizes every `@wordpress/*` import to the
  matching `wp.*` global and sets esbuild's JSX pragma to
  `wp.element.createElement`/`Fragment` automatically — no new npm
  dependencies were needed, `npm run build` picks up
  `@wordpress/{blocks,block-editor,components,server-side-render,i18n,
  dom-ready}` as externals and emits the right WP script-handle list to
  `editor.deps.json` (verified: a clean `npm run build` after this pass
  produced `wp-blocks`, `wp-block-editor`, `wp-components`,
  `wp-server-side-render`, `wp-i18n`, `wp-dom-ready`).
- `wpackagist-plugin/meta-box` removed from the root `composer.json` (with
  it, `bin/fix-meta-box-autoload.php` and its Dockerfile/composer.json
  script wiring, added in pass 2 to work around that plugin's packaging
  bug) — nothing else in the theme used Meta Box. Verified: `composer
  update wpackagist-plugin/meta-box` cleanly removed it from
  `composer.lock` and `web/app/plugins/meta-box/`.

**Was a placeholder, resolved in pass 5 below:** `cecf_site_settings`
(org info, footer columns) was still a native Settings API screen with no
field-by-field UI yet (`CecfContentServiceProvider::
renderSiteSettingsPage()`) — smaller in scope than the 20-section-type
problem this pass solved, and a reasonable next follow-up.

## 8. Pass 5 — site-wide settings in the native Customizer (2026-08-16)

Replaced the pass-4 Settings API placeholder screen with real controls in
Appearance → Customize. `App\Providers\CecfContentServiceProvider` now
registers a "CECF Settings" panel (organisation info, contact
emails/hours, footer text, one section per footer column, the header
button) with `type => 'option'` settings whose IDs are bracketed paths
into the *same* `cecf_site_settings` option
`database/seeders/SiteSettingsSeeder.php` already wrote and
`sections/{header,footer}.blade.php` already read — WordPress's own
Customizer core resolves `cecf_site_settings[footerColumns][0][links][2]
[label]`-style IDs via `_wp_array_set()` on save, so no custom
`WP_Customize_Setting` subclass and no reshaping of the option was
needed.

Footer columns/links are the one variable-cardinality part of this
option; the Customizer has no native repeater control, so this exposes a
fixed, generous number of slots (`FOOTER_COLUMN_SLOTS = 4`,
`FOOTER_LINK_SLOTS = 8`, one above `navigation.json`'s current widest
column) rather than hand-rolling dynamic-section JS — a blank link label
or column heading just doesn't render (`sections/footer.blade.php` and
`sections/header.blade.php` both updated to skip empty slots, the latter
also fixed to hide the header CTA entirely rather than render an
empty-label button when only `page` is set).

Verified in the `cecf` docker profile via a real `WP_Customize_Manager`
instance (`do_action('customize_register', $manager)`): all 8 sections
and 88 settings register; every setting's `->value()` correctly reads
back the already-seeded option data (spot-checked `orgName`, a footer
column heading, and a nested link label three levels deep); a real
`set_post_value()` + `->save()` write (as a logged-in user — capability
checks fail silently otherwise) round-trips correctly and leaves every
sibling key in the option untouched. Front end still renders clean
afterward.

## 9. Pass 6 — moved block editing out of the Inspector sidebar (2026-08-23)

Pass 4 put every `cecf/*` block's fields in the Inspector sidebar (a
`PanelBody` inside `InspectorControls`), a workable pattern for one or
two plain-text fields but not for this theme's actual blocks: `cardGrid`
can hold 8 items each with an icon/color/title/body, `ctaBand` repeats a
`{label, page, style, icon}` group per button, `table` repeats rows of
cells — all cramped into a ~280px-wide sidebar, cards nested inside
cards. Confirmed this was the real complaint behind "still feels like
Meta Box to edit," not anything left over from Meta Box itself (verified
separately: `composer.json` has no Meta Box dependency, no PHP calls
`rwmb_*`, `web/app/plugins/meta-box/` isn't git-tracked — see pass 4).

- `resources/js/blocks/register.jsx`: `edit()` no longer wraps
  `<SectionForm>` in `<InspectorControls>`. The canvas now shows either
  the edit form (full block width) or the real `<ServerSideRender>`
  preview, toggled by a `BlockControls` toolbar button (`Edit`/`Preview`,
  local `useState`, defaults to `Edit` — not a block attribute, so it's
  never written to `post_content`).
- `resources/js/blocks/fields.jsx`: every repeatable field (`stringList`,
  `rowList`, `repeater`) gained move-up/move-down buttons alongside
  add/remove — reordering previously meant deleting and re-adding items
  in the right order. No drag-and-drop library added: with items that can
  be an editor's-height tall, a button that always moves an item exactly
  one slot is more reliable to use than dragging a tall card past several
  others.
- `app/setup.php`'s `block_editor_settings_all` filter now also imports
  `blocks-admin.css` into the block editor's iframed canvas (alongside
  `editor.css`, already there for `<ServerSideRender>`'s Tailwind), since
  apiVersion-3 blocks render `edit()` inside that iframe — the existing
  `admin_head` enqueue of the same file only ever reached the outer
  wp-admin chrome, which is why the sidebar version looked fine before
  but canvas-rendered fields wouldn't have picked up any styling at all
  without this.

Verified: `pnpm --filter @esoko/cecf-sage-theme build` compiles clean
(9 modules, no warnings beyond the pre-existing pnpm workspace ones).
