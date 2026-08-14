<?php

namespace Database\Seeders;

use App\Content\ContentRepository;
use App\Providers\CecfContentServiceProvider;

/**
 * Writes database/content/site-settings.json — plus navigation.json's
 * footerColumns and primaryCta, which conceptually belong with "site-wide
 * settings" rather than the primary wp_nav_menu NavigationSeeder builds —
 * into the `cecf_site_settings` option that
 * App\Providers\CecfContentServiceProvider's Settings API screen reads.
 */
class SiteSettingsSeeder
{
    public function __construct(protected ContentRepository $content)
    {
    }

    public function run(): void
    {
        $settings = $this->content->siteSettings();
        $nav = $this->content->navigation();

        $settings['footerColumns'] = $nav['footerColumns'] ?? [];
        $settings['primaryCta'] = $nav['primaryCta'] ?? null;

        update_option(CecfContentServiceProvider::SETTINGS_OPTION, $settings);
    }
}
