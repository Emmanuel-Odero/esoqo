# CECF seed content

This folder lives **inside the `cecf-sage` theme** (not at the Bedrock-app
level) because it's presentation content for this theme specifically, not
core WordPress data — the same reasoning that puts it under `database/`
alongside where the seeder classes that consume it (`database/seeders/`,
see `../docs/content-seeding-plan.md`) will live, mirroring Laravel's own
`database/seeders` + `database/factories` split, since Sage 11 runs on
`roots/acorn` (Laravel-in-WordPress) and is invoked via `wp acorn`.

**IA note (2026-08-11):** the original template had 21 pages under a 5-group
dropdown mega-nav; this was later consolidated down to 7 pages (Home, About,
Programs, Partnerships, Impact, Apply, Contact), each absorbing its former
sibling pages as in-page anchored subsections rather than separate URLs. See
`pages/_index.json`'s `note` field and `../navigation.json`'s `note` field for
the full mapping. The rest of this doc, and `docs/content-seeding-plan.md`,
describe the original 21-page inventory the content was extracted from —
still accurate as extraction history, just no longer the live page count.

This folder is the **source of truth for real CECF copy** — extracted verbatim
from `cecf-theme-design-template.html` (the approved design template) and
restructured into data the seeder (not yet built — see
`../docs/content-seeding-plan.md`) reads to populate the Bedrock database.
Nothing in here is Lorem Ipsum; every string is CECF's own text from the
template, reorganised so it can be typed into custom fields instead of
hand-copied from a design mockup.

It is **not** WordPress-specific on its own — it's plain JSON + SVG so it can
be reviewed, diffed and edited by a non-technical content owner in a text
editor or a future headless-CMS import, independent of which WordPress
field-plugin we end up wiring it to (see the plan doc for that decision).

## Layout

```
web/app/themes/cecf-sage/
├── database/
│   ├── content/            ← you are here
│   │   ├── site-settings.json   org name, phone, emails, footer blurb, socials
│   │   ├── navigation.json      primary nav (with dropdown groups) + footer nav columns
│   │   ├── pages/
│   │   │   ├── _index.json      registry of all 7 pages (post IA consolidation, see below): slug, title, kicker, meta description
│   │   │   └── <slug>.json      one file per page — an ordered array of typed "sections"
│   │   └── media/
│   │       ├── illustrations/   the ~8 unique bespoke brand-illustration SVGs, deduped
│   │       │                    (the template repeats several of these byte-for-byte
│   │       │                    across multiple pages — we store each once and pages
│   │       │                    reference it by filename)
│   │       ├── icons/           NOT populated — see decision note below
│   │       └── photos/          NOT populated — see PLACEHOLDERS.md
│   └── seeders/             NOT YET BUILT — App\Console\Commands, `wp acorn cecf:seed`
└── docs/content-seeding-plan.md   the research/decision doc this folder implements
```

## Section schema

**Editor note (2026-08-15):** the field-plugin decision this doc originally
deferred (§3.1 of `../docs/content-seeding-plan.md`) landed on real Gutenberg
blocks, not a plugin — each `type` below is now a `cecf/<type>` block
(`App\Providers\CecfBlocksServiceProvider`), edited in the normal `page`
block editor screen with real per-field controls
(`App\Content\SectionFields`), not the Meta Box JSON-textarea field this
section used to describe. This JSON tree is still what `wp acorn cecf:seed`
reads to seed the 8 real pages (`database/seeders/PageSeeder.php` now
converts each section straight to block markup), and it's still handy as a
readable copy source — but it's not the live editing surface CECF staff use.

Each `pages/<slug>.json` is `{ "sections": [ {...}, {...} ] }`. Every section
has a `type` that maps 1:1 to a component already defined in the template's
CSS (`.hero`, `.cards3`, `.tbl`, `.events`, …) and, downstream, to one Blade
partial (`resources/views/partials/cecf/<type>.blade.php`) plus one Gutenberg
block of the same name. This mapping is deliberate: the JSON here is written
so it maps **directly** onto a block's `data` attribute without another
reshaping pass. Types in use:

| `type` | Template CSS class(es) | Purpose |
|---|---|---|
| `hero` | `.hero` | Homepage masthead only |
| `phead` | `.phead` | Page-top banner (kicker + H1 + lead) on every non-home page |
| `prose` | plain `<p class="lead">` runs | Freeform paragraphs, no card/grid structure |
| `twoColumn` | `.two`, `.two.rev` | Prose beside an illustration or photo |
| `statGrid` | `.stat4`, `.factbox` | 3–4 up number/label stat row |
| `cardGrid` | `.cards3`, `.cards2`, `.pcard`/`.card` | Icon card grid, optionally clickable |
| `stepList` | `.steps4`, `.steps4.col` | Numbered process steps |
| `requirementList` | `.reqs`/`.rq` | Checklist rows (done / optional) |
| `table` | `.tbl` | Column/row data table |
| `eventList` | `.events`/`.ev` | Dated event cards |
| `newsList` | `.news`/`.nw` | News article summaries |
| `storyList` | `.stories`/`.story` | Testimonial blocks with photo + pull-quote |
| `downloadList` | `.dlist`/`.dl` | Publication/report download rows |
| `sponsorshipGrid` | `.spons`/`.sp` | Sponsorship tier cards |
| `partnerList` | `.plist`/`.pr` | Institution/partner rows |
| `ctaBand` | `.band` | Full-width closing call-to-action |
| `callout` | `.callout` | Highlighted aside |
| `note` | `.note`, `.note.warn` | Info / warning notice |
| `registrationForm` | `.fcard` (page `form` only) | Copy for the existing 6-step JS wizard; the wizard's *behaviour* stays code, not content |
| `teamGrid` | `.cards3`/`.cards4`, `.member`, `.avatar` | Staff/board/advisor cards — name, role, bio, initials avatar (added 2026-08-16 for `pages/team.json`, not part of the original template extraction) |

Icons are referenced by a short semantic **name** (`"icon": "bank"`,
`"icon": "handshake"`), not by inlining SVG markup or a template CSS class.
See the icon decision below.

## Deliberate scoping decisions (flagged for approval — see plan doc)

1. **Icons are theme assets, not seed content.** The template inlines the
   same ~40 small 24×24 stroke icons hundreds of times. Re-storing that
   markup per page in the database would bloat every row and make a global
   icon restyle require a database edit. `content/media/icons/` is
   intentionally empty; the plan doc recommends a small icon-name → SVG map
   living in the Sage theme (`resources/images/icons/` + a Blade `<x-icon>`
   component), and page JSON here only ever carries the icon's *name*.
2. **Photos are placeholders in the template, not CECF's own photography.**
   The template hot-links Wikimedia Commons stock photos for `stories`,
   `government` and `careers`. We have **not** copied them into this repo —
   see `media/photos/PLACEHOLDERS.md` for why, and what we need from CECF
   before launch.
3. **Illustrations are real, reusable CECF-brand SVG art** (not stock, not
   Lorem-Ipsum-equivalent) — these *are* copied in verbatim, deduped, and
   pages reference them by filename.

## Path note

Every reference to `content/...` elsewhere in this repo's docs (including
the plan doc) means this folder,
`web/app/themes/cecf-sage/database/content/`, not a top-level
`services/cecf-wordpress/content/` — the seed data was relocated into the
theme on 2026-08-07 because it is cecf-sage-specific, not Bedrock-app-wide.
