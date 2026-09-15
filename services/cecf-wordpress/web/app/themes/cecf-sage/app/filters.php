<?php

/**
 * Theme filters.
 */

namespace App;

use App\Support\PageUrl;
use Database\Seeders\PageSeeder;

/**
 * Add "… Continued" to the excerpt.
 *
 * @return string
 */
add_filter('excerpt_more', function () {
    return sprintf(' &hellip; <a href="%s">%s</a>', get_permalink(), __('Continued', 'sage'));
});

/**
 * The "apply" page now has a working `registrationForm` partial
 * (partials/cecf/registrationForm.blade.php) — someone who lands on
 * /apply directly (an old link, a bookmark, a search result) gets the
 * real form the same as anyone arriving through a CTA. The one
 * remaining redirect is the CECF_LOCAL_REGISTRATION_ENABLED=false
 * operational kill-switch, same override PageUrl::resolve() honours for
 * every generated CTA — see its own docblock.
 *
 * @return void
 */
add_action('template_redirect', function () {
    if (! is_page() || env('CECF_LOCAL_REGISTRATION_ENABLED', true) !== false) {
        return;
    }

    $key = get_post_meta(get_queried_object_id(), PageSeeder::KEY_META, true);

    if ($key === 'apply') {
        wp_redirect(PageUrl::esoqoJoinUrl(), 302);
        exit;
    }
});
