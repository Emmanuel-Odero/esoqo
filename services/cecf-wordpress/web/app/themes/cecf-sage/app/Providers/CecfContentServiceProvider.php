<?php

namespace App\Providers;

use App\Content\SectionTypes;
use Illuminate\Support\ServiceProvider;

/**
 * Registers the two structured-content surfaces CECF staff edit content
 * through, once Meta Box (wpackagist-plugin/meta-box, required in the
 * Bedrock-root composer.json) is active:
 *
 *  1. A "Page sections" field group on the `page` post type — a
 *     repeatable (clone) group of {type, label, data} rows, one per
 *     section, matching database/content/pages/<slug>.json's shape.
 *
 *  2. A native WordPress Settings API screen for site-wide settings
 *     (org info, footer columns) — NOT a Meta Box "settings page".
 *     Meta Box core only ships object-type detection for settings
 *     screens (see RWMB_Object_Type::normalize() in the plugin source);
 *     the actual storage backend for that object type lives in the
 *     separate "MB Settings Page" extension, which is not reliably
 *     resolvable through this project's Composer repositories. Rather
 *     than add an unverifiable plugin dependency, site settings use
 *     `register_setting()`/the Settings API directly — free, built into
 *     WordPress core, and just as real an admin GUI for CECF staff.
 *
 * Why one field per {type, label, data-as-JSON} instead of a fully
 * decomposed field per section type (e.g. a dedicated repeater UI for
 * `cardGrid` vs `table` vs `storyList`, …): the 20 section types in
 * SectionTypes::options() have genuinely different, sometimes
 * variable-depth shapes (table.rows is an array of arrays; storyList
 * items carry multi-paragraph bodies; cardGrid items are flat). Building
 * 20 bespoke field-group UIs is real scope, deliberately deferred — see
 * docs/content-seeding-plan.md. This gets working, round-trippable,
 * editable content live now without blocking on that follow-up.
 */
class CecfContentServiceProvider extends ServiceProvider
{
    public const SETTINGS_OPTION = 'cecf_site_settings';

    public const SETTINGS_PAGE_SLUG = 'cecf-settings';

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_filter('rwmb_meta_boxes', [$this, 'registerPageSectionsField']);

        add_action('admin_menu', [$this, 'registerSiteSettingsPage']);
        add_action('admin_init', [$this, 'registerSiteSettingsFields']);
    }

    /**
     * @param  array<int, array<string, mixed>>  $metaBoxes
     * @return array<int, array<string, mixed>>
     */
    public function registerPageSectionsField(array $metaBoxes): array
    {
        $metaBoxes[] = [
            'id' => 'cecf_page_sections',
            'title' => __('Page sections', 'cecf-sage'),
            'post_types' => ['page'],
            'context' => 'normal',
            'priority' => 'high',
            'fields' => [
                [
                    'id' => 'cecf_sections',
                    'type' => 'group',
                    'clone' => true,
                    'sort_clone' => true,
                    'collapsible' => true,
                    'add_button' => __('+ Add section', 'cecf-sage'),
                    'fields' => [
                        [
                            'id' => 'type',
                            'name' => __('Section type', 'cecf-sage'),
                            'type' => 'select',
                            'options' => SectionTypes::options(),
                            'required' => true,
                        ],
                        [
                            'id' => 'label',
                            'name' => __('Editor label', 'cecf-sage'),
                            'type' => 'text',
                            'desc' => __('For your own reference in this list only — never shown on the site.', 'cecf-sage'),
                        ],
                        [
                            'id' => 'data',
                            'name' => __('Section data (JSON)', 'cecf-sage'),
                            'type' => 'textarea',
                            'rows' => 12,
                            'desc' => __('Structured content for this one section. See database/content/README.md for the field shape each "Section type" expects.', 'cecf-sage'),
                        ],
                    ],
                ],
            ],
        ];

        return $metaBoxes;
    }

    public function registerSiteSettingsPage(): void
    {
        add_options_page(
            __('CECF Settings', 'cecf-sage'),
            __('CECF Settings', 'cecf-sage'),
            'manage_options',
            self::SETTINGS_PAGE_SLUG,
            [$this, 'renderSiteSettingsPage']
        );
    }

    public function registerSiteSettingsFields(): void
    {
        register_setting('cecf_site_settings_group', self::SETTINGS_OPTION, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitizeSettings'],
            'default' => [],
        ]);
    }

    /**
     * Deliberately permissive: this option stores a nested structure
     * (footer columns, county lists, …) that a single flat sanitizer
     * can't meaningfully field-validate. Access is already gated by
     * `manage_options`; each value is escaped at output time by whatever
     * Blade partial renders it, not here.
     *
     * @param  mixed  $value
     * @return array<string, mixed>
     */
    public function sanitizeSettings($value): array
    {
        return is_array($value) ? $value : [];
    }

    public function renderSiteSettingsPage(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        echo '<div class="wrap"><h1>'.esc_html__('CECF Settings', 'cecf-sage').'</h1>';
        echo '<p>'.esc_html__('This screen is a placeholder for a follow-up pass — site settings are currently seeded from database/content/site-settings.json via `wp acorn cecf:seed --settings` and stored under the option key "'.self::SETTINGS_OPTION.'". A field-by-field editing UI (org info, footer columns) is deferred alongside the per-section-type Meta Box fields noted above.', 'cecf-sage').'</p>';
        echo '</div>';
    }
}
