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
 * The "apply" page itself has never had a working `registrationForm`
 * partial (see missing.blade.php) — every CTA that points at it is
 * already redirected to the real Esoko join flow via
 * App\Support\PageUrl::resolve(). This closes the one gap that leaves
 * open: someone who lands on /apply directly (an old link, a bookmark,
 * a search result) rather than through a CTA.
 *
 * @return void
 */
add_action('template_redirect', function () {
    if (! is_page()) {
        return;
    }

    $key = get_post_meta(get_queried_object_id(), PageSeeder::KEY_META, true);

    if ($key === 'apply') {
        wp_redirect(PageUrl::esokoJoinUrl(), 302);
        exit;
    }
});
