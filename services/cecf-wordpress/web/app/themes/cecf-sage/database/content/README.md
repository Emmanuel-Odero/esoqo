# CECF seed content

This folder lives **inside the `cecf-sage` theme** (not at the Bedrock-app
level) because it's presentation content for this theme specifically, not
core WordPress data — the same reasoning that puts it under `database/`
alongside where the seeder classes that consume it (`database/seeders/`,
see `../docs/content-seeding-plan.md`) will live, mirroring Laravel's own
`database/seeders` + `database/factories` split, since Sage 11 runs on
`roots/acorn` (Laravel-in-WordPress) and is invoked via `wp acorn`.

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
│   │   │   ├── _index.json      registry of all 21 pages: slug, title, kicker, meta description
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

Each `pages/<slug>.json` is `{ "sections": [ {...}, {...} ] }`. Every section
has a `type` that maps 1:1 to a component already defined in the template's
CSS (`.hero`, `.cards3`, `.tbl`, `.events`, …) and, downstream, to one Blade
partial (`resources/views/sections/<type>.blade.php`) plus one Meta Box
group/clone field group of the same name. This mapping is deliberate: the
JSON here is written so it can be loaded **directly** into the chosen
structured-fields plugin without another reshaping pass. Types in use:

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
