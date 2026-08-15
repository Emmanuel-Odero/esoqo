<?php

namespace Database\Seeders;

use App\Content\ContentRepository;
use App\Content\SectionTypes;
use RuntimeException;
use WP_Query;

/**
 * Upserts the 21 real WordPress pages and their section content, per the
 * approved architecture decision in docs/content-seeding-plan.md §3.2
 * (real page URLs, not the design template's #/route hash router).
 *
 * Idempotent by design: every seeded page carries a `_cecf_page_key` post
 * meta value (the stable key from pages/_index.json, e.g. "about" —
 * distinct from its editable `slug`), so re-running always finds and
 * updates the same post rather than creating duplicates, even if a slug
 * is later renamed in wp-admin.
 */
class PageSeeder
{
    public const KEY_META = '_cecf_page_key';

    public function __construct(protected ContentRepository $content) {}

    /**
     * @return array<string, int> page key => post ID
     */
    public function run(): array
    {
        $ids = [];

        foreach ($this->content->pages() as $meta) {
            $ids[$meta['key']] = $this->upsertPage($meta);
        }

        return $ids;
    }

    /**
     * Look up already-seeded pages without writing anything — used when a
     * later step (e.g. navigation) needs page IDs but --pages wasn't part
     * of this run.
     *
     * @return array<string, int> page key => post ID
     */
    public function existingPageIds(): array
    {
        $query = new WP_Query([
            'post_type' => 'page',
            'post_status' => 'any',
            'meta_key' => self::KEY_META,
            'fields' => 'ids',
            'posts_per_page' => -1,
            'no_found_rows' => true,
        ]);

        $ids = [];
        foreach ($query->posts as $postId) {
            $key = get_post_meta($postId, self::KEY_META, true);
            if ($key) {
                $ids[$key] = $postId;
            }
        }

        return $ids;
    }

    protected function upsertPage(array $meta): int
    {
        $key = $meta['key'];
        $isHome = ! empty($meta['isHome']);
        $slug = $isHome ? 'home' : $meta['slug'];
        $sections = $this->content->page($key)['sections'] ?? [];

        $this->assertSectionsValid($key, $sections);

        $existingId = $this->findExisting($key);

        $postArr = [
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_title' => $meta['title'] ?: 'Home',
            'post_name' => $slug,
            'post_content' => $this->sectionsToBlockMarkup($sections),
            'meta_input' => [
                self::KEY_META => $key,
            ],
        ];

        if ($existingId) {
            $postArr['ID'] = $existingId;
            $postId = wp_update_post($postArr, true);
        } else {
            $postId = wp_insert_post($postArr, true);
        }

        if (is_wp_error($postId)) {
            throw new RuntimeException("Failed to seed page '{$key}': " . $postId->get_error_message());
        }

        if ($isHome) {
            update_option('show_on_front', 'page');
            update_option('page_on_front', $postId);
        }

        return $postId;
    }

    /**
     * @param  array<int, array<string, mixed>>  $sections
     */
    protected function assertSectionsValid(string $key, array $sections): void
    {
        foreach ($sections as $i => $section) {
            $type = $section['type'] ?? null;

            if (! is_string($type) || ! SectionTypes::isValid($type)) {
                throw new RuntimeException(sprintf(
                    "Page '%s' section #%d has an unrecognised type: %s. Add it to App\\Content\\SectionTypes if this is intentional.",
                    $key,
                    $i,
                    var_export($type, true),
                ));
            }
        }
    }

    /**
     * Builds real Gutenberg block markup — one self-closing `cecf/<type>`
     * block per section (App\Providers\CecfBlocksServiceProvider), each
     * carrying the section's fields as its `data` attribute. This is what
     * a Content Manager building the same page by hand in the block
     * editor would end up with in `post_content`; seeding writes it
     * directly rather than going through wp_insert_post()'s content
     * filters, since there's no user input here to run through those.
     *
     * `wp_json_encode()` HTML-encodes automatically (JSON_HEX_* isn't
     * needed) but not enough on its own to be safe inside an HTML
     * comment attribute string the same way `serialize_block()` writes
     * one — matching WP core's own escaping (`--` and `</` inside string
     * values) keeps this byte-for-byte what `serialize_blocks()` would
     * produce for the same attributes, so a round-trip through the block
     * editor (open, don't touch anything, save) doesn't rewrite the post.
     *
     * @param  array<int, array<string, mixed>>  $sections
     */
    protected function sectionsToBlockMarkup(array $sections): string
    {
        $markup = [];

        foreach ($sections as $section) {
            $type = $section['type'];
            unset($section['type']);

            $block = [
                'blockName' => SectionTypes::blockName($type),
                'attrs' => ['data' => $section],
                'innerBlocks' => [],
                'innerHTML' => '',
                'innerContent' => [],
            ];

            $markup[] = serialize_block($block);
        }

        return implode("\n\n", $markup);
    }

    protected function findExisting(string $key): ?int
    {
        $query = new WP_Query([
            'post_type' => 'page',
            'post_status' => 'any',
            'meta_key' => self::KEY_META,
            'meta_value' => $key,
            'fields' => 'ids',
            'posts_per_page' => 1,
            'no_found_rows' => true,
        ]);

        return $query->posts[0] ?? null;
    }
}
