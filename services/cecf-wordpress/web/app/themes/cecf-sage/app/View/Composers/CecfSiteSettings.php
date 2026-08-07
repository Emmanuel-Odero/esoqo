<?php

namespace App\View\Composers;

use App\Providers\CecfContentServiceProvider;
use Roots\Acorn\View\Composer;

/**
 * Exposes `cecf_site_settings` (written by database/seeders/
 * SiteSettingsSeeder.php — org info, phone/emails, footer columns) to the
 * header and footer chrome as `$cecfSettings`. Every other view composer
 * in this theme (App, Post) follows the same "one small, single-purpose
 * composer" pattern already established in app/View/Composers/.
 */
class CecfSiteSettings extends Composer
{
    protected static $views = [
        'sections.header',
        'sections.footer',
    ];

    public function with()
    {
        return [
            'cecfSettings' => get_option(CecfContentServiceProvider::SETTINGS_OPTION, []),
        ];
    }
}
