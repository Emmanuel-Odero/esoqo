<?php

namespace App\Providers;

use App\Content\ContentRepository;
use App\Content\SectionTypes;
use App\Customizer\CecfSectionControl;
use App\Customizer\CecfSectionSetting;
use Database\Seeders\PageSeeder;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use WP_Customize_Manager;

/**
 * A second editing surface for the *same* page content the block editor
 * (App\Providers\CecfBlocksServiceProvider) already edits — one
 * Customizer panel per seeded page, one section per `cecf/*` block on
 * it, live-previewed in the standard Appearance -> Customize iframe on
 * the right while its fields are edited on the left. Not a second data
 * model: every control here reads/writes the exact same block inside the
 * exact same page's `post_content` the block editor does (see
 * App\Customizer\CecfSectionSetting), through the exact same
 * `<SectionForm>` field components (resources/js/customizer-controls.jsx
 * mounts resources/js/blocks/fields.jsx directly) — pick whichever
 * editing surface fits the moment, they can't drift apart from each
 * other because there's only one underlying representation.
 *
 * Registered dynamically from whatever's currently seeded (`PageSeeder::
 * existingPageIds()` + each page's current `parse_blocks()` output), not
 * from database/content/*.json — a Content Manager's already-published
 * edits are what this reflects, the JSON is only ever the seed source
 * for a page's first save.
 */
class CecfPageEditorServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_action('customize_register', [$this, 'registerCustomizer']);
        add_action('customize_controls_enqueue_scripts', [$this, 'enqueueControls']);
    }

    public function registerCustomizer(WP_Customize_Manager $wp_customize): void
    {
        // No register_control_type() call needed: that's only for
        // controls a JS template creates dynamically client-side (e.g.
        // widgets/nav-menus screens' "add new" flows). Every
        // CecfSectionControl below is instantiated in PHP and passed
        // straight to add_control(), which core renders server-side via
        // render_content() like any other PHP-only control.
        $content = new ContentRepository();
        $titles = [];
        foreach ($content->pages() as $page) {
            $titles[$page['key']] = $page['title'] ?? $page['key'];
        }

        $panelUrls = [];
        $priority = 0;

        foreach ((new PageSeeder($content))->existingPageIds() as $key => $postId) {
            $panelId = "cecf_page_{$key}";
            $priority += 10;

            $wp_customize->add_panel($panelId, [
                'title' => $titles[$key] ?? $key,
                'description' => __('Edits the same page content the block editor does — changes here show live in the preview and publish the same way.', 'cecf-sage'),
                'priority' => 100 + $priority, // after cecf_site_settings (priority 10)
            ]);

            // Deliberately get_permalink($postId), not PageUrl::resolve($key)
            // — resolve() has a special case for "jamii" that sends CTAs
            // to Esoqo's external product site, not this page's own
            // local URL, since a "jamii" key names both (a CTA target
            // and a real seeded WP page, see PageUrl's own docblock).
            // This needs the latter: where the preview iframe should
            // actually point to edit this page.
            $panelUrls[$panelId] = get_permalink($postId) ?: home_url('/');

            $this->registerPageSections($wp_customize, $panelId, $postId);
        }

        wp_add_inline_script('customize-controls', 'window.cecfPagePanelUrls = ' . wp_json_encode($panelUrls) . ';', 'before');
    }

    protected function registerPageSections(WP_Customize_Manager $wp_customize, string $panelId, int $postId): void
    {
        $post = get_post($postId);
        if (! $post) {
            return;
        }

        $blocks = parse_blocks((string) $post->post_content);
        $index = -1;

        foreach ($blocks as $block) {
            $type = SectionTypes::typeFromBlockName((string) ($block['blockName'] ?? ''));
            if ($type === null) {
                continue;
            }

            $index++;
            $sectionId = "{$panelId}_section_{$index}";
            $settingId = "{$panelId}_data_{$index}";

            $wp_customize->add_section($sectionId, [
                'title' => sprintf('%d. %s', $index + 1, SectionTypes::options()[$type] ?? $type),
                'panel' => $panelId,
                'priority' => $index,
            ]);

            $wp_customize->add_setting(new CecfSectionSetting(
                $wp_customize,
                $settingId,
                ['type' => 'cecf_section', 'transport' => 'refresh', 'default' => []],
                $postId,
                $index,
            ));

            $wp_customize->add_control(new CecfSectionControl(
                $wp_customize,
                $settingId,
                ['section' => $sectionId, 'settings' => $settingId],
                $type,
            ));
        }
    }

    public function enqueueControls(): void
    {
        if (! Vite::isRunningHot()) {
            // @roots/vite-plugin's wordpressPlugin() only ever emits one
            // deps manifest for the whole build, always named
            // "editor.deps.json" regardless of which entrypoint(s)
            // actually import @wordpress/* — not per-entrypoint despite
            // the name, so this is the right file to read here too, not
            // a customizer-controls-specific one that doesn't exist.
            $dependencies = json_decode(Vite::content('editor.deps.json'));

            foreach ($dependencies as $dependency) {
                if (! wp_script_is($dependency)) {
                    wp_enqueue_script($dependency);
                }
            }
        }

        // window.cecfSectionSchema/etc. — the same globals resources/js/
        // blocks/fields.jsx already reads in the block editor
        // (App\Providers\CecfBlocksServiceProvider::localizeEditorData()),
        // needed here too since wp-customize.php never fires
        // enqueue_block_editor_assets. Printed as a plain classic
        // <script> rather than via wp_add_inline_script(): that helper
        // needs an already core/Vite-registered script handle to attach
        // to, and customizer-controls.jsx below is printed as a raw
        // `type="module"` tag (Vite::withEntryPoints()->toHtml(), needed
        // for Vite dev-mode HMR to work) that never touches
        // wp_register_script() at all — no handle exists to attach to. A
        // classic script always executes before a module script that
        // appears later in the same document regardless, so this still
        // guarantees the globals exist before that module runs.
        echo '<script>' . CecfBlocksServiceProvider::schemaInlineJs() . '</script>';

        echo Vite::withEntryPoints([
            'resources/js/customizer-controls.jsx',
            'resources/css/blocks-admin.css',
        ])->toHtml();
    }
}
