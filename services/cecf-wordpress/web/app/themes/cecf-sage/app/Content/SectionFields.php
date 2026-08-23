<?php

namespace App\Content;

/**
 * Per-section-type field schema — the thing that replaced the "Section
 * data (JSON)" textarea (formerly registered in
 * App\Providers\CecfContentServiceProvider, now removed; see
 * App\Providers\CecfBlocksServiceProvider) with one real Gutenberg block
 * per `SectionTypes` value, so a Content Manager edits a labelled field
 * ("Heading", "Items", "Icon") instead of hand-writing JSON.
 *
 * This is the single source of truth two very different consumers read
 * from, so the field list only ever needs to change in one place:
 *
 *  - PHP: App\Providers\CecfBlocksServiceProvider prints this whole array
 *    to the block editor as `window.cecfSectionSchema` (see
 *    resources/js/blocks/schema.js) — the JS side has no hand-written
 *    per-block field list, it builds all ~20 blocks' Inspector controls
 *    generically from what's declared here.
 *  - The block itself still stores one `data` object attribute (the same
 *    shape database/content/pages/ pages-JSON already used per section, minus
 *    `type`/`label`) — the schema only shapes the *editing UI*; storage
 *    stays a single object, same as e.g. core/query's attributes.
 *
 * Field `type` values the generic editor (resources/js/blocks/Field.js)
 * and PHP side both understand:
 *   text         — single-line string
 *   textarea     — multi-line string; content may use markdown-lite
 *                  emphasis (see App\Support\Markdown, unchanged) or, for `prose`-
 *                  shaped fields, a leading "### " line for a sub-heading
 *   number        — numeric string
 *   boolean       — checkbox
 *   select        — one of `options` (value => label)
 *   page          — select from real WP page keys (App\Support\PageUrl)
 *   icon          — select from the theme's icon set (App\Support\Icon)
 *   illustration  — select from database/content/media/illustrations/*.svg
 *   stringList    — repeatable list of plain strings (facts, ticks, body
 *                   paragraphs)
 *   rowList       — repeatable list of stringList rows (table body only)
 *   repeater      — repeatable list of objects shaped by nested `fields`
 *   group         — one fixed object shaped by nested `fields` (not
 *                   repeatable — a single cta/media sub-object)
 */
class SectionFields
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public static function forType(string $type): array
    {
        return self::schemas()[$type] ?? [];
    }

    /**
     * @return array<string, array<int, array<string, mixed>>>
     */
    public static function schemas(): array
    {
        return [
            'hero' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
                self::illustration('illustration', 'Illustration'),
                self::ctas('ctas', 'Buttons'),
                self::stringList('facts', 'Facts (short badges under the buttons)'),
            ],
            'phead' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
            ],
            'prose' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::text('anchor', 'Anchor ID (for in-page links, e.g. "governance")'),
                self::stringList('body', 'Paragraphs', multiline: true),
            ],
            'twoColumn' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::text('anchor', 'Anchor ID (for in-page links)'),
                self::select('variant', 'Style', ['' => 'Default', 'dark' => 'Dark band']),
                self::boolean('reverse', 'Show media on the left instead of the right'),
                self::stringList('prose', 'Paragraphs (a paragraph starting with "### " becomes a sub-heading)', multiline: true),
                self::text('subheading', 'Checklist sub-heading'),
                self::stringList('ticks', 'Checklist items'),
                self::repeater('requirementList', 'Requirement checklist', [
                    self::select('status', 'Status', ['done' => 'Done', 'optional' => 'Optional']),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Detail'),
                    self::text('highlight', 'Highlighted note (e.g. a fee)'),
                ]),
                self::repeater('downloadList', 'Downloads', [
                    self::text('title', 'Title'),
                    self::text('meta', 'File info (e.g. "PDF · 2.1MB")'),
                    self::text('tag', 'Tag'),
                ]),
                self::textarea('callout', 'Callout box'),
                self::text('secondTicksHeading', 'Second checklist heading'),
                self::stringList('secondTicks', 'Second checklist items'),
                self::textarea('fineprint', 'Fine print'),
                self::cta('cta', 'Button'),
                self::stringList('secondColumnProse', 'Second-column paragraphs', multiline: true),
                self::group('media', 'Media', [
                    self::select('type', 'Media type', [
                        '' => '— None —',
                        'illustration' => 'Illustration',
                        'photo' => 'Photo',
                        'statGrid' => 'Stat grid',
                    ]),
                    self::illustration('ref', 'Illustration (when type is "Illustration")'),
                    self::text('alt', 'Alt text (when type is "Illustration")'),
                    self::text('caption', 'Caption (when type is "Photo")'),
                    self::text('heading', 'Stat grid heading (when type is "Stat grid")'),
                    self::select('columns', 'Stat grid columns', ['3' => '3 (tinted)', '4' => '4 (white cards)']),
                    self::repeater('items', 'Stat grid items', [
                        self::text('value', 'Value'),
                        self::text('label', 'Label'),
                    ]),
                    self::textarea('fineprint', 'Stat grid fine print'),
                ]),
            ],
            'statGrid' => [
                self::text('heading', 'Heading'),
                self::select('columns', 'Columns', ['3' => '3 (tinted)', '4' => '4 (white cards)']),
                self::repeater('items', 'Stats', [
                    self::text('value', 'Value'),
                    self::text('label', 'Label'),
                ]),
                self::textarea('fineprint', 'Fine print'),
            ],
            'cardGrid' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
                self::text('anchor', 'Anchor ID (for in-page links)'),
                self::select('columns', 'Columns', ['2' => '2', '3' => '3', '4' => '4']),
                self::select('variant', 'Layout', ['' => 'Cards', 'missionVision' => 'Mission / vision (no page links)']),
                self::repeater('items', 'Cards', [
                    self::icon('icon', 'Icon'),
                    self::color('color', 'Colour'),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Body'),
                    self::stringList('mono', 'Monospace detail lines'),
                    self::page('page', 'Links to page'),
                ]),
            ],
            'stepList' => [
                self::text('heading', 'Heading'),
                self::select('layout', 'Layout', ['column' => 'Column', 'row' => 'Row']),
                self::repeater('items', 'Steps', [
                    self::text('n', 'Step number'),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Body'),
                ]),
            ],
            'requirementList' => [
                self::text('heading', 'Heading'),
                self::repeater('items', 'Requirements', [
                    self::select('status', 'Status', ['done' => 'Done', 'optional' => 'Optional']),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Detail'),
                    self::text('highlight', 'Highlighted note (e.g. a fee)'),
                ]),
            ],
            'table' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
                self::stringList('columns', 'Column headings'),
                self::rowList('rows', 'Table rows'),
                self::textarea('fineprint', 'Fine print'),
            ],
            'eventList' => [
                self::text('heading', 'Heading'),
                self::boolean('featured', 'Larger "featured" cards'),
                self::repeater('items', 'Events', [
                    self::text('month', 'Month (e.g. "Sep")'),
                    self::text('day', 'Day (e.g. "14")'),
                    self::text('tag', 'Tag'),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Body'),
                    self::text('location', 'Location'),
                    self::text('time', 'Time'),
                ]),
            ],
            'newsList' => [
                self::text('heading', 'Heading'),
                self::repeater('items', 'Articles', [
                    self::text('date', 'Date'),
                    self::text('tag', 'Tag'),
                    self::text('title', 'Title'),
                    self::stringList('body', 'Paragraphs', multiline: true),
                ]),
            ],
            'storyList' => [
                self::repeater('items', 'Stories', [
                    self::boolean('reverse', 'Reverse layout'),
                    self::text('tag', 'Tag'),
                    self::text('title', 'Title'),
                    self::stringList('body', 'Paragraphs', multiline: true),
                    self::textarea('quote', 'Pull quote'),
                ]),
            ],
            'downloadList' => [
                self::text('heading', 'Heading'),
                self::repeater('items', 'Downloads', [
                    self::text('title', 'Title'),
                    self::text('meta', 'File info (e.g. "PDF · 2.1MB")'),
                    self::text('tag', 'Tag'),
                ]),
            ],
            'sponsorshipGrid' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::repeater('items', 'Sponsorship tiers', [
                    self::icon('icon', 'Icon'),
                    self::color('color', 'Colour'),
                    self::text('title', 'Title'),
                    self::textarea('body', 'Body'),
                    self::text('measure', 'Measure (e.g. a price)'),
                ]),
            ],
            'partnerList' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
                self::repeater('items', 'Partners', [
                    self::icon('icon', 'Icon'),
                    self::text('name', 'Name'),
                    self::text('role', 'Role'),
                ]),
                self::cta('cta', 'Button'),
            ],
            'teamGrid' => [
                self::text('kicker', 'Kicker'),
                self::text('heading', 'Heading'),
                self::textarea('lead', 'Lead paragraph'),
                self::select('columns', 'Columns', ['2' => '2', '3' => '3', '4' => '4']),
                self::repeater('items', 'People', [
                    self::text('name', 'Name'),
                    self::text('role', 'Role / title'),
                    self::textarea('bio', 'Short bio'),
                    self::color('color', 'Avatar colour'),
                    self::text('email', 'Email (optional, shown as a mailto link)'),
                ]),
            ],
            'ctaBand' => [
                self::text('heading', 'Heading'),
                self::textarea('body', 'Body'),
                self::ctas('ctas', 'Buttons'),
            ],
            'callout' => [
                self::text('heading', 'Heading'),
                self::textarea('body', 'Body'),
            ],
            'note' => [
                self::select('variant', 'Style', ['info' => 'Info', 'warn' => 'Warning', 'fineprint' => 'Fine print']),
                self::textarea('body', 'Body'),
            ],
            'registrationForm' => [
                self::textarea('body', 'Notes (copy only — the 6-step wizard itself is code, not editable here)'),
            ],
            'linkOut' => [
                self::text('label', 'Label'),
                self::page('page', 'Links to page'),
                self::select('style', 'Style', ['primary' => 'Primary', 'outline' => 'Outline', 'outline-white' => 'Outline (white)']),
                self::icon('icon', 'Icon'),
            ],
            'linkRow' => [
                self::ctas('items', 'Buttons'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function text(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'text'];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function textarea(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'textarea'];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function boolean(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'boolean'];
    }

    /**
     * @param  array<string, string>  $options
     * @return array<string, mixed>
     */
    protected static function select(string $key, string $label, array $options): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'select', 'options' => $options];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function page(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'page'];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function icon(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'icon'];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function illustration(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'illustration'];
    }

    protected static function color(string $key, string $label): array
    {
        return self::select($key, $label, [
            'teal' => 'Teal',
            'ochre' => 'Ochre',
            'clay' => 'Clay',
            'green' => 'Green',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    protected static function stringList(string $key, string $label, bool $multiline = false): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'stringList', 'multiline' => $multiline];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function rowList(string $key, string $label): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'rowList'];
    }

    /**
     * @param  array<int, array<string, mixed>>  $fields
     * @return array<string, mixed>
     */
    protected static function repeater(string $key, string $label, array $fields): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'repeater', 'fields' => $fields];
    }

    /**
     * @param  array<int, array<string, mixed>>  $fields
     * @return array<string, mixed>
     */
    protected static function group(string $key, string $label, array $fields): array
    {
        return ['key' => $key, 'label' => $label, 'type' => 'group', 'fields' => $fields];
    }

    /**
     * A {label, page, style, icon} button — hero/ctaBand's `ctas`,
     * linkRow's `items`, twoColumn/partnerList's `cta`, and linkOut all
     * share this exact shape; defined once here.
     */
    protected static function cta(string $key, string $label): array
    {
        return self::group($key, $label, [
            self::text('label', 'Label'),
            self::page('page', 'Links to page'),
            self::select('style', 'Style', ['primary' => 'Primary', 'outline' => 'Outline', 'outline-white' => 'Outline (white)']),
            self::icon('icon', 'Icon'),
        ]);
    }

    /**
     * A repeatable list of `cta()`-shaped buttons.
     */
    protected static function ctas(string $key, string $label): array
    {
        return self::repeater($key, $label, [
            self::text('label', 'Label'),
            self::page('page', 'Links to page'),
            self::select('style', 'Style', ['primary' => 'Primary', 'outline' => 'Outline', 'outline-white' => 'Outline (white)']),
            self::icon('icon', 'Icon'),
        ]);
    }
}
