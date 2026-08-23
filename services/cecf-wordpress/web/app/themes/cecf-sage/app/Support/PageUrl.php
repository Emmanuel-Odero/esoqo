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

        // "apply" resolves locally again — the `registrationForm` section
        // now has a real partial (partials/cecf/registrationForm.blade.php,
        // backed by App\Providers\CecfRegistrationServiceProvider) instead
        // of missing.blade.php's placeholder, so every "Register"/"Apply"
        // CTA site-wide can go straight to the working local form. Falls
        // through to the normal seeded-page lookup below — except for the
        // one operational escape hatch: setting CECF_LOCAL_REGISTRATION_
        // ENABLED=false sends every CTA back to esoko's own /join without
        // a deploy, if the local flow ever needs pulling in a hurry.
        if ($key === 'apply' && env('CECF_LOCAL_REGISTRATION_ENABLED', true) === false) {
            return self::esokoJoinUrl();
        }

        // "Our Jamii" (pages/jamii.json) is a real local page introducing
        // the product, but the product itself — browsing a group's own live
        // page, or a group's own dashboard — only ever exists on Esoko's
        // Our Jamii app, never on this WordPress site. Every "page": "jamii"
        // CTA goes straight there, unconditionally (unlike "apply" above,
        // there is no local equivalent to fall back to).
        if ($key === 'jamii') {
            return self::esokoJamiiUrl();
        }

        $url = self::map()[$key] ?? null;

        return $url && $anchor ? "{$url}#{$anchor}" : $url;
    }

    public static function esokoJoinUrl(): string
    {
        return env('ESOKO_JOIN_URL', 'http://localhost:3001/join');
    }

    public static function esokoJamiiUrl(): string
    {
        // apps/jamii's own (site)/page.tsx — the "discover" listing of
        // every published Our Jamii page — lives at the app's root, not a
        // /discover path segment.
        return env('ESOKO_JAMII_URL', 'http://localhost:3004/');
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
