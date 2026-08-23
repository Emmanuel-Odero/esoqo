<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use WP_Customize_Manager;

/**
 * Site-wide settings (org info, contact details, footer columns, header
 * CTA) — the content `sections.header`/`sections.footer` render as
 * `$cecfSettings` (App\View\Composers\CecfSiteSettings) — are editable in
 * the native Appearance → Customize screen, with the standard WordPress
 * live preview (the preview iframe refreshes on change).
 *
 * All of it is one flat `cecf_site_settings` option — the exact same
 * option `database/seeders/SiteSettingsSeeder.php` writes from
 * `database/content/site-settings.json`/`navigation.json`, and the exact
 * same shape `sections/{header,footer}.blade.php` already read. Every
 * control below is a `type => 'option'` setting whose ID is a bracketed
 * path into that option (e.g. `cecf_site_settings[orgName]`,
 * `cecf_site_settings[footerColumns][0][links][2][label]`) — WordPress's
 * own Customizer core resolves that path with `_wp_array_set()` on save,
 * so this needed no custom `WP_Customize_Setting` subclass and no
 * transform between what a control edits and what a Blade partial reads:
 * the option's shape never changes, only how each piece of it gets
 * edited.
 *
 * Page body content (the ~20 `cecf/*` block types) is a different
 * concern from this provider's flat `cecf_site_settings` option — each
 * page's sections are real Gutenberg blocks in that page's own
 * `post_content`, not part of this option at all — but it does now also
 * have a Customizer panel of its own per page, alongside this one; see
 * App\Providers\CecfPageEditorServiceProvider, which needed a custom
 * `WP_Customize_Setting`/`WP_Customize_Control` pair
 * (App\Customizer\CecfSectionSetting/CecfSectionControl) precisely
 * because it doesn't fit this provider's `type => 'option'` pattern.
 *
 * Footer columns/links are the one part of this option with a variable
 * number of items (`navigation.json` currently has 4 columns, the
 * longest with 8 links) but the Customizer has no native "repeater"
 * control — every WordPress Customizer implementation that needs one
 * either hand-rolls dynamic section/control JS or, as here, exposes a
 * fixed number of slots generously sized above the current content
 * (`FOOTER_COLUMN_SLOTS`/`FOOTER_LINK_SLOTS` below). An empty slot's
 * `label` is blank, and `sections/footer.blade.php` already only prints
 * links (and now columns) with a non-empty label/heading, so unused
 * slots just don't render — adding a 9th link or 5th column later only
 * means raising these two constants, not restructuring anything.
 */
class CecfContentServiceProvider extends ServiceProvider
{
    public const SETTINGS_OPTION = 'cecf_site_settings';

    public const FOOTER_COLUMN_SLOTS = 4;

    public const FOOTER_LINK_SLOTS = 8;

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        add_action('customize_register', [$this, 'registerCustomizer']);
    }

    public function registerCustomizer(WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_panel('cecf_site_settings', [
            'title' => __('CECF Settings', 'cecf-sage'),
            'description' => __('Organisation info, contact details and footer navigation shown on every page — seeded from database/content/, hand-editable here from now on.', 'cecf-sage'),
            'priority' => 10,
        ]);

        $this->registerOrganisationSection($wp_customize);
        $this->registerContactSection($wp_customize);
        $this->registerFooterSection($wp_customize);
        $this->registerFooterColumnSections($wp_customize);
        $this->registerPrimaryCtaSection($wp_customize);
    }

    protected function registerOrganisationSection(WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_section('cecf_organisation', [
            'title' => __('Organisation', 'cecf-sage'),
            'panel' => 'cecf_site_settings',
            'priority' => 10,
        ]);

        $this->text($wp_customize, 'orgName', __('Organisation name', 'cecf-sage'), 'cecf_organisation', 10);
        $this->text($wp_customize, 'orgShortName', __('Short name (header/mobile menu)', 'cecf-sage'), 'cecf_organisation', 20);
        $this->text($wp_customize, 'tagline', __('Tagline', 'cecf-sage'), 'cecf_organisation', 30);
        $this->text($wp_customize, 'locationLine', __('Location line (e.g. "Nairobi, Kenya")', 'cecf-sage'), 'cecf_organisation', 40);
        $this->text($wp_customize, 'phoneDisplay', __('Phone number (as displayed)', 'cecf-sage'), 'cecf_organisation', 50);
        $this->textarea($wp_customize, 'metaDescription', __('Meta description', 'cecf-sage'), 'cecf_organisation', 60);
    }

    protected function registerContactSection(WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_section('cecf_contact', [
            'title' => __('Contact', 'cecf-sage'),
            'panel' => 'cecf_site_settings',
            'priority' => 20,
        ]);

        $emails = [
            'groups' => __('Groups email', 'cecf-sage'),
            'partnerships' => __('Partnerships email', 'cecf-sage'),
            'events' => __('Events email', 'cecf-sage'),
            'complaints' => __('Complaints email', 'cecf-sage'),
            'careers' => __('Careers email', 'cecf-sage'),
            'reportsRequest' => __('Reports-request email', 'cecf-sage'),
        ];

        $priority = 10;
        foreach ($emails as $key => $label) {
            $this->text($wp_customize, "emails][{$key}", $label, 'cecf_contact', $priority, 'sanitize_email');
            $priority += 10;
        }

        $hours = [
            'weekdays' => __('Weekday hours', 'cecf-sage'),
            'saturday' => __('Saturday hours', 'cecf-sage'),
            'phoneLine' => __('Phone line hours', 'cecf-sage'),
        ];

        foreach ($hours as $key => $label) {
            $this->text($wp_customize, "hours][{$key}", $label, 'cecf_contact', $priority);
            $priority += 10;
        }
    }

    protected function registerFooterSection(WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_section('cecf_footer', [
            'title' => __('Footer text', 'cecf-sage'),
            'panel' => 'cecf_site_settings',
            'priority' => 30,
        ]);

        $this->textarea($wp_customize, 'footer][blurb', __('Footer blurb', 'cecf-sage'), 'cecf_footer', 10);
        $this->text($wp_customize, 'footer][bottomLeft', __('Bottom-left line (org name / registration)', 'cecf-sage'), 'cecf_footer', 20);
        $this->text($wp_customize, 'footer][bottomRight', __('Bottom-right line', 'cecf-sage'), 'cecf_footer', 30);
    }

    protected function registerFooterColumnSections(WP_Customize_Manager $wp_customize): void
    {
        for ($c = 0; $c < self::FOOTER_COLUMN_SLOTS; $c++) {
            $sectionId = "cecf_footer_column_{$c}";

            $wp_customize->add_section($sectionId, [
                /* translators: %d: footer column number, 1-indexed */
                'title' => sprintf(__('Footer column %d', 'cecf-sage'), $c + 1),
                'panel' => 'cecf_site_settings',
                'priority' => 40 + $c,
                'description' => __('Leave a link\'s label blank to hide that slot. "Links to" accepts a page key (see database/content/pages/_index.json) optionally followed by "#anchor".', 'cecf-sage'),
            ]);

            $this->text(
                $wp_customize,
                "footerColumns][{$c}][heading",
                __('Column heading', 'cecf-sage'),
                $sectionId,
                0,
            );

            for ($l = 0; $l < self::FOOTER_LINK_SLOTS; $l++) {
                $priority = 10 + ($l * 10);

                $this->text(
                    $wp_customize,
                    "footerColumns][{$c}][links][{$l}][label",
                    /* translators: %d: link slot number, 1-indexed */
                    sprintf(__('Link %d label', 'cecf-sage'), $l + 1),
                    $sectionId,
                    $priority,
                );

                $this->text(
                    $wp_customize,
                    "footerColumns][{$c}][links][{$l}][page",
                    /* translators: %d: link slot number, 1-indexed */
                    sprintf(__('Link %d links to', 'cecf-sage'), $l + 1),
                    $sectionId,
                    $priority + 5,
                );
            }
        }
    }

    protected function registerPrimaryCtaSection(WP_Customize_Manager $wp_customize): void
    {
        $wp_customize->add_section('cecf_primary_cta', [
            'title' => __('Header button', 'cecf-sage'),
            'panel' => 'cecf_site_settings',
            'priority' => 50,
            'description' => __('The call-to-action button shown in the header on every page. Leave the label blank to hide it.', 'cecf-sage'),
        ]);

        $this->text($wp_customize, 'primaryCta][label', __('Button label', 'cecf-sage'), 'cecf_primary_cta', 10);
        $this->text($wp_customize, 'primaryCta][page', __('Links to (page key, optionally "#anchor")', 'cecf-sage'), 'cecf_primary_cta', 20);
    }

    /**
     * Registers a single-line text `WP_Customize_Setting` + matching
     * `WP_Customize_Control`, both bound to `cecf_site_settings[$path]` —
     * `$path` is the bracketed remainder of the option array path (e.g.
     * `"orgName"`, or `"footerColumns][0][heading"` for a nested key,
     * since the caller is what's already inside the brackets after the
     * top-level option name).
     */
    protected function text(
        WP_Customize_Manager $wp_customize,
        string $path,
        string $label,
        string $section,
        int $priority,
        string $sanitize = 'sanitize_text_field',
    ): void {
        $id = self::SETTINGS_OPTION . "[{$path}]";

        $wp_customize->add_setting($id, [
            'type' => 'option',
            'default' => '',
            'sanitize_callback' => $sanitize,
            'transport' => 'refresh',
        ]);

        $wp_customize->add_control($id, [
            'type' => 'text',
            'label' => $label,
            'section' => $section,
            'priority' => $priority,
        ]);
    }

    protected function textarea(
        WP_Customize_Manager $wp_customize,
        string $path,
        string $label,
        string $section,
        int $priority,
    ): void {
        $id = self::SETTINGS_OPTION . "[{$path}]";

        $wp_customize->add_setting($id, [
            'type' => 'option',
            'default' => '',
            'sanitize_callback' => 'sanitize_textarea_field',
            'transport' => 'refresh',
        ]);

        $wp_customize->add_control($id, [
            'type' => 'textarea',
            'label' => $label,
            'section' => $section,
            'priority' => $priority,
        ]);
    }
}
