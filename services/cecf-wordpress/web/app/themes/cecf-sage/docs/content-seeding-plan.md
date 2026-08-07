# CECF content seeding — research & recommendation

**Status:** decisions approved 2026-08-07 (§4); PHP has not been written
yet. `database/content/` (this theme's git-tracked seed source, moved here
from a top-level `services/cecf-wordpress/content/` on the same date since
it's cecf-sage-specific, not Bedrock-app-wide) has been populated as
groundwork; the seeder itself, the Meta Box field registration, and the
page-routing change described below are **not yet implemented**.

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

**Recommendation: Options page**, consistent with 3.1's engine choice.

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
    ├── PageSeeder.php             #   composer.json psr-4 addition: "Database\\": "database/"
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

**Delivered (this pass, non-destructive, no DB writes):**
- `database/content/` — git-tracked seed source: `site-settings.json`,
  `navigation.json`, `pages/_index.json`, `pages/<21 files>.json`,
  8 deduped illustration SVGs, and documentation of the two deliberate
  content gaps (icons, photos).

**Approved (2026-08-07):**
1. ✅ Meta Box (free) as the structured-fields engine — §3.1
2. ✅ Converting hash-routes to real WP page slugs — §3.2
3. ✅ Options-page model for footer columns — §3.3 (implied by #1)
4. ✅ Custom CPT + REST for the registration form, vs. a forms plugin — §3.4
5. ✅ Gradient-fallback placeholder for un-sourced photos, not Wikimedia downloads — §3.6 revision below

**Still open / next implementation pass:**
- Build `database/seeders/` + `app/Console/Commands/CecfSeedCommand.php`
  per the shape in §3.5, plus the `composer.json` psr-4 addition it needs.
- `composer require metabox/meta-box` (or the WPackagist mirror name
  confirmed at implementation time) + register the "Page Sections"
  group/clone field group and the `site-settings` options page.
- Register the `cecf_enquiry` CPT + REST route for the registration form.
- Add 21 Blade section partials (`resources/views/sections/<type>.blade.php`)
  matching the 18 `type` values in §2, consumed by `page.blade.php` looping
  over the Meta Box field data.
- Update `app/setup.php`'s `register_nav_menus()` to keep `primary_navigation`
  fed from real WP menu items (seeded from `database/content/navigation.json`) instead
  of the template's static markup.
