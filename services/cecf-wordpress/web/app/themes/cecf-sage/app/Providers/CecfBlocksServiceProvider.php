<?php

namespace App\Providers;

use App\Content\ContentRepository;
use App\Content\SectionFields;
use App\Content\SectionTypes;
use Illuminate\Support\ServiceProvider;

/**
 * Registers one native Gutenberg block per `SectionTypes` value
 * ("cecf/hero", "cecf/card-grid", …) on the `page` post type — the
 * replacement for the old single "Page sections" Meta Box field, whose
 * every row was a hand-written JSON blob (see git history:
 * App\Providers\CecfContentServiceProvider before this pass, and
 * docs/content-seeding-plan.md's "Still open" list, which flagged
 * decomposing that JSON as future work).
 *
 * Content Managers now build a page the way WordPress normally works:
 * open a page in the block editor, use the "+" inserter (grouped under
 * the "CECF sections" category registered below, or via the block
 * patterns registerPatterns() adds below — "insert a pattern" instead of
 * custom fields is "the usual way WordPress content shows"), fill in
 * labelled fields in the sidebar, see the real styled section update
 * live in the canvas, drag to reorder, publish. Nothing here requires
 * wp-admin's Custom Fields panel.
 *
 * Design, in one place so it doesn't need repeating on every block:
 *  - Every block has exactly one attribute, `data` (a plain object) — the
 *    same shape a section's entry in database/content/pages/*.json
 *    already had (minus `type`). This mirrors how core blocks like
 *    core/query store a structured object in one attribute; what makes
 *    editing "the usual WordPress way" is the *editor UI* (real labelled
 *    controls, built generically from App\Content\SectionFields — see
 *    resources/js/blocks/), not how many top-level attributes the
 *    serialized comment happens to have.
 *  - `render_callback` hands `data` straight to the *same* Blade partial
 *    (resources/views/partials/cecf/<type>.blade.php) the old Meta Box
 *    pipeline rendered — those partials, and every App\Support\* helper
 *    they call (Markdown, PageUrl, Icon, Media, ButtonStyle), are
 *    completely unchanged by this pass. Only how `$data` gets produced
 *    changed: parsed from real block content
 *    (App\View\Composers\PageSections) instead of decoded from a JSON
 *    string.
 *  - Field labels/types come from App\Content\SectionFields, localized to
 *    the editor as `window.cecfSectionSchema` so there's one generic
 *    React field-renderer (resources/js/blocks/fields.jsx), not 20
 *    hand-written edit.js files.
 */
class CecfBlocksServiceProvider extends ServiceProvider
{
    public const CATEGORY = 'cecf-sections';

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_filter('block_categories_all', [$this, 'registerCategory']);
        add_action('init', [$this, 'registerBlocks']);
        add_action('init', [$this, 'registerPatterns']);
        add_action('enqueue_block_editor_assets', [$this, 'localizeEditorData']);
    }

    /**
     * @param  array<int, array<string, mixed>>  $categories
     * @return array<int, array<string, mixed>>
     */
    public function registerCategory(array $categories): array
    {
        array_unshift($categories, [
            'slug' => self::CATEGORY,
            'title' => __('CECF sections', 'cecf-sage'),
        ]);

        return $categories;
    }

    /**
     * A handful of starter layouts so a Content Manager building a new
     * page doesn't have to know which of the ~20 block types to reach for
     * first — "Insert a pattern" is as native a WordPress workflow as the
     * block inserter itself. Each pattern is just ordinary blocks with
     * placeholder copy; inserting one drops real, already-editable
     * cecf/* blocks into the page, same as inserting any core pattern.
     */
    public function registerPatterns(): void
    {
        register_block_pattern_category(self::CATEGORY, [
            'label' => __('CECF page starters', 'cecf-sage'),
        ]);

        register_block_pattern('cecf/basic-page', [
            'title' => __('CECF: basic content page', 'cecf-sage'),
            'description' => __('Page header, an intro paragraph, and a closing call-to-action band.', 'cecf-sage'),
            'categories' => [self::CATEGORY],
            'content' => $this->blocks([
                ['phead', ['kicker' => 'Kicker', 'heading' => 'Page heading', 'lead' => 'A short lead paragraph introducing this page.']],
                ['prose', ['heading' => 'Section heading', 'body' => ['Replace this paragraph with your own copy.']]],
                ['ctaBand', ['heading' => 'Call to action heading', 'body' => 'A short prompt.', 'ctas' => [['label' => 'Button label', 'page' => 'home', 'style' => 'primary']]]],
            ]),
        ]);

        register_block_pattern('cecf/highlights-page', [
            'title' => __('CECF: highlights page', 'cecf-sage'),
            'description' => __('Page header, a stat grid, a card grid, and a closing call-to-action band.', 'cecf-sage'),
            'categories' => [self::CATEGORY],
            'content' => $this->blocks([
                ['phead', ['kicker' => 'Kicker', 'heading' => 'Page heading', 'lead' => 'A short lead paragraph introducing this page.']],
                ['statGrid', ['heading' => 'By the numbers', 'columns' => '4', 'items' => [['value' => '000', 'label' => 'Stat label'], ['value' => '000', 'label' => 'Stat label']]]],
                ['cardGrid', ['heading' => 'Section heading', 'columns' => '3', 'items' => [['icon' => 'target', 'color' => 'teal', 'title' => 'Card title', 'body' => 'Card body copy.']]]],
                ['ctaBand', ['heading' => 'Call to action heading', 'body' => 'A short prompt.', 'ctas' => [['label' => 'Button label', 'page' => 'home', 'style' => 'primary']]]],
            ]),
        ]);
    }

    /**
     * @param  array<int, array{0: string, 1: array<string, mixed>}>  $sections  [type, data] pairs
     */
    protected function blocks(array $sections): string
    {
        $markup = '';

        foreach ($sections as [$type, $data]) {
            $attrs = wp_json_encode(['data' => $data]);
            $markup .= '<!-- wp:' . SectionTypes::blockName($type) . " {$attrs} /-->\n\n";
        }

        return trim($markup);
    }

    public function registerBlocks(): void
    {
        foreach (SectionTypes::values() as $type) {
            register_block_type(SectionTypes::blockName($type), [
                'title' => SectionTypes::options()[$type],
                'category' => self::CATEGORY,
                'icon' => 'layout',
                'attributes' => [
                    'data' => ['type' => 'object', 'default' => new \stdClass()],
                ],
                'supports' => [
                    'html' => false,
                    'anchor' => false,
                ],
                'render_callback' => fn(array $attributes) => $this->render($type, $attributes),
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    protected function render(string $type, array $attributes): string
    {
        $data = (array) ($attributes['data'] ?? []);

        return view()->exists("partials.cecf.{$type}")
            ? (string) view("partials.cecf.{$type}", ['data' => $data, 'label' => SectionTypes::options()[$type] ?? $type])
            : (string) view('partials.cecf.missing', ['data' => $data, 'label' => SectionTypes::options()[$type] ?? $type]);
    }

    /**
     * Hands the block editor everything App\Content\SectionFields's
     * schema references by name instead of raw value: the field list
     * itself, the page keys a "page" field can link to (with human
     * titles, not raw keys, in the picker), the icon set a "icon" field
     * can choose from, and the illustration filenames an "illustration"
     * field can choose from. One inline script, read by
     * resources/js/blocks/schema.js — no REST round-trip needed since
     * none of this changes while the editor is open.
     */
    public function localizeEditorData(): void
    {
        $screen = get_current_screen();
        if (! $screen || $screen->post_type !== 'page') {
            return;
        }

        $content = new ContentRepository();

        $schema = [];
        foreach (SectionTypes::values() as $type) {
            $schema[$type] = SectionFields::forType($type);
        }

        $pages = [];
        foreach ($content->pages() as $page) {
            $pages[$page['key']] = $page['title'] ?? $page['key'];
        }

        $icons = [];
        foreach (glob(get_theme_file_path('resources/images/icons/*.svg')) ?: [] as $path) {
            $name = basename($path, '.svg');
            $icons[$name] = $name;
        }

        $illustrations = array_keys($content->illustrations());

        wp_add_inline_script(
            'wp-blocks',
            'window.cecfSectionSchema = ' . wp_json_encode($schema) . ';'
            . 'window.cecfBlockCategory = ' . wp_json_encode(self::CATEGORY) . ';'
            . 'window.cecfSectionLabels = ' . wp_json_encode(SectionTypes::options()) . ';'
            . 'window.cecfPageOptions = ' . wp_json_encode($pages) . ';'
            . 'window.cecfIconOptions = ' . wp_json_encode($icons) . ';'
            . 'window.cecfIllustrationOptions = ' . wp_json_encode(array_combine($illustrations, $illustrations)) . ';',
            'before',
        );
    }
}
