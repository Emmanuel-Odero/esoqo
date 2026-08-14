<?php

namespace App\Support;

use Database\Seeders\MediaSeeder;
use WP_Query;

/**
 * Resolves an illustration filename (e.g. "community-gathering.svg", the
 * `media.ref` value in section JSON) to its seeded media-library URL, by
 * the same `_cecf_illustration_filename` post meta database/seeders/
 * MediaSeeder.php writes when it uploads each SVG. One query per request
 * (cached in-memory), not one per section.
 *
 * Deliberately has no equivalent "photo" resolver — see database/content/
 * media/photos/PLACEHOLDERS.md and twoColumn.blade.php's `.ph.fallback`
 * branch; every current photo `ref` is a PLACEHOLDER-* marker with
 * nothing seeded to look up.
 */
class Media
{
    /** @var array<string, string>|null filename => URL */
    protected static ?array $map = null;

    public static function illustrationUrl(string $filename): ?string
    {
        if ($filename === '') {
            return null;
        }

        return self::map()[$filename] ?? null;
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
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'meta_key' => MediaSeeder::FILENAME_META,
            'fields' => 'ids',
            'posts_per_page' => -1,
            'no_found_rows' => true,
        ]);

        foreach ($query->posts as $postId) {
            $filename = get_post_meta($postId, MediaSeeder::FILENAME_META, true);

            if ($filename) {
                self::$map[$filename] = wp_get_attachment_url($postId);
            }
        }

        return self::$map;
    }
}
