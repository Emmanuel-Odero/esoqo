<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * A native WordPress Settings API screen for site-wide settings (org
 * info, footer columns) — free, built into WordPress core, no plugin.
 *
 * Page content itself no longer goes through this provider. Every
 * section is now a real Gutenberg block, registered by
 * App\Providers\CecfBlocksServiceProvider and edited on the normal
 * `page` block-editor screen instead of a Meta Box panel below it. This
 * class used to also register that "Page sections" field — a repeatable
 * clone group whose every row was a hand-written JSON textarea — via
 * `rwmb_meta_boxes`; removed once the block-based editor replaced it,
 * along with the wpackagist-plugin/meta-box Composer dependency it
 * needed (nothing else in the theme used Meta Box — see the root
 * composer.json diff in the same commit that added
 * CecfBlocksServiceProvider).
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
        add_action('admin_menu', [$this, 'registerSiteSettingsPage']);
        add_action('admin_init', [$this, 'registerSiteSettingsFields']);
    }

    public function registerSiteSettingsPage(): void
    {
        add_options_page(
            __('CECF Settings', 'cecf-sage'),
            __('CECF Settings', 'cecf-sage'),
            'manage_options',
            self::SETTINGS_PAGE_SLUG,
            [$this, 'renderSiteSettingsPage'],
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

        echo '<div class="wrap"><h1>' . esc_html__('CECF Settings', 'cecf-sage') . '</h1>';
        echo '<p>' . esc_html__('This screen is a placeholder for a follow-up pass — site settings are currently seeded from database/content/site-settings.json via `wp acorn cecf:seed --settings` and stored under the option key "' . self::SETTINGS_OPTION . '". A field-by-field editing UI (org info, footer columns) is the next piece of this work, tracked in docs/content-seeding-plan.md.', 'cecf-sage') . '</p>';
        echo '</div>';
    }
}
