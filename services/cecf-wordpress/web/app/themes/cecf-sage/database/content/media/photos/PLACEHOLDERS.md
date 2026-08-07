# Photo placeholders — do not seed as final content

The design template hot-links five raster photos directly from
`upload.wikimedia.org` (Wikimedia Commons) plus one broken local reference.
None of these are CECF's own photography. We have **not** downloaded or
copied any of them into this repo. Reasons:

1. **Licensing is per-file and unverified.** Wikimedia Commons images carry
   individual licences (commonly CC BY-SA, which requires attribution and,
   for some, share-alike on derivatives) — we would need to check each
   file's actual licence page and carry correct attribution text, which
   nobody has done yet.
2. **They are not CECF's beneficiaries.** Using stock photos of unrelated
   Kenyan markets/traders as if they depict CECF's actual work risks
   misrepresenting the organisation's real reach — a reputational, not just
   legal, risk for a nonprofit.
3. **Hot-linking to Wikimedia from the seeded site is also not viable long
   term** (no caching control, no guarantee the file stays at that URL,
   pulls a third-party dependency into page load).

## Full inventory of placeholder photo references in the template

| Page | Alt text used | Original hot-linked URL | Seed key used in `content/pages/*.json` |
|---|---|---|---|
| problem | "Members of a community group gathered at a communal function in Kenya" | `./assets/community-group.svg` (already broken in the template — falls back to the `.ph.fallback` gradient) | `community-group-meeting` |
| stories | "A woman selling carrots at a Kenyan market" | `upload.wikimedia.org/.../Woman_sells_carrots_in_a_muddy_market...jpg` | `PLACEHOLDER-woman-market-trader` |
| stories | "A trader selling bananas at a market in Kenya" | `upload.wikimedia.org/.../Woman_sells_banana_in_a_market...jpg` | `PLACEHOLDER-banana-trader` |
| stories | "A busy market in Eastleigh, Nairobi" | `upload.wikimedia.org/.../Garissa_Market%2C_Eastleigh_in_Nairobi.jpg` | `PLACEHOLDER-eastleigh-market` |
| government | "The Nairobi city skyline" | `upload.wikimedia.org/.../Nairobi_City_County_Skyline.jpg` | `PLACEHOLDER-nairobi-skyline` |
| careers | "A farmer cutting sugarcane for milling" | `upload.wikimedia.org/.../A_farmer_cutting_sugarcane_for_milling.jpg` | `PLACEHOLDER-sugarcane-farmer` |

Every `media.ref` value in `content/pages/*.json` that starts with
`PLACEHOLDER-` is a **known gap**, not an oversight — the seeder should skip
attaching a featured/inline image for that block (or fall back to the
`.ph.fallback` teal→green gradient already defined in the template's CSS,
which is designed exactly for this) rather than silently pulling the
Wikimedia original into production.

## What we need from CECF before launch

Real, consented photography of: a group meeting/training session, a market
trader or MSME owner, the Nairobi office or a field visit, and — if usable —
a photo representing rural/agricultural beneficiaries. The `stories` page in
particular should not go live with stock photography standing in for named
testimonials; see the note already in `content/pages/stories.json`.

## Recommended interim treatment (until real photography exists)

Use the template's own `.ph.fallback` illustrated-gradient placeholder
(already styled, already accessible — it's triggered automatically by the
`<img onerror="...">` the template ships with) rather than any stock photo.
This is a zero-cost, zero-licence-risk placeholder that visually matches the
brand and is explicitly designed into the CSS for exactly this situation.
