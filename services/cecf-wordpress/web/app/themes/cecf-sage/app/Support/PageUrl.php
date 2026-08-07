<?php

namespace App\Support;

use Database\Seeders\PageSeeder;
use WP_Query;

/**
 * Resolves a page's stable content `key` (e.g. "problem", from
 * database/content/pages/_index.json — NOT its editable slug, "the-problem")
 * to its real permalink. Every JSON `"page": "<key>"` reference — nav
 * items, footer links, CTAs, cardGrid/linkOut targets — goes through this
 * rather than each call site guessing at `home_url("/{$key}/")`, which
 * silently breaks the moment a key and its slug diverge (most of them do:
 * "register" -> "/register-your-group/", not "/register/").
 *
 * One query per request (cached in-memory), not one per link.
 */
class PageUrl
{
    /** @var array<string, string>|null key => permalink */
    protected static ?array $map = null;

    public static function resolve(string $key): ?string
    {
        if ($key === 'home') {
            return home_url('/');
        }

        // A JSON `page` value can carry an in-page anchor, e.g. "about#consortium".
        [$key, $anchor] = array_pad(explode('#', $key, 2), 2, null);

        $url = self::map()[$key] ?? null;

        return $url && $anchor ? "{$url}#{$anchor}" : $url;
    }

    /**
     * @return array<string, string>
     */
    protected static function map(): array
    {
        if (self::$map !== null) {
            return self::$map;
        }

        self::$map = [];

        $query = new WP_Query([
            'post_type' => 'page',
            'post_status' => 'publish',
            'meta_key' => PageSeeder::KEY_META,
            'fields' => 'ids',
            'posts_per_page' => -1,
            'no_found_rows' => true,
        ]);

        foreach ($query->posts as $postId) {
            $key = get_post_meta($postId, PageSeeder::KEY_META, true);

            if ($key) {
                self::$map[$key] = get_permalink($postId);
            }
        }

        return self::$map;
    }
}
