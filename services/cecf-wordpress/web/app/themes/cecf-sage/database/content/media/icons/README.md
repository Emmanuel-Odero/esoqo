# Icons — intentionally not seeded here

This folder is a placeholder marker, not a gap. See `content/README.md` §
"Deliberate scoping decisions" for the reasoning.

The template inlines the same set of ~40 small (24×24, `currentColor`,
1.8px stroke) icons hundreds of times across the 21 pages — one nav
chevron, one card-badge icon, one button icon, repeated verbatim wherever
it's used. Storing that raw SVG markup per instance in seeded page content
(as the JSON files in `../../pages/` briefly do for the `hero` illustration
before this decision was made) would mean:

- every page load re-parses dozens of duplicate `<svg>` blocks instead of
  one cached theme asset,
- restyling an icon (stroke width, a Kiswahili-friendly icon swap, etc.)
  becomes a database content edit instead of a one-line theme change,
- content editors would be pasting/breaking raw SVG markup in a WYSIWYG
  field, which is exactly the kind of fragility a CMS project should design
  away from.

**Recommendation (pending approval — see `../../docs/content-seeding-plan.md`
decision table):** the ~25 distinct icons actually used (nav chevron, arrow,
target, compass, document, chart-bars, puzzle, government-building, receipt,
scales, map-pin, people, shield, globe, fish/failure, calendar, mail,
table-banking, cooperative, grid, bar-chart-line, close, menu, check,
warning) live as individual files in
`web/app/themes/cecf-sage/resources/images/icons/*.svg`, and every `icon`
key referenced in `content/pages/*.json` (e.g. `"icon": "bank"`) is a lookup
against that folder's filenames, rendered through a small Blade component
(`<x-icon name="bank" />`) or inlined at build time via Vite's SVG plugin.
That work belongs to the Sage theme build, not this content-seeding folder,
and is out of scope for this content-inventory pass.
