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

    public function __construct(protected ContentRepository $content)
    {
    }

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
            throw new RuntimeException("Failed to seed page '{$key}': ".$postId->get_error_message());
        }

        $this->writeSections($postId, $sections);

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
                    var_export($type, true)
                ));
            }
        }
    }

    /**
     * Writes to the Meta Box "cecf_sections" group+clone field registered
     * in App\Providers\CecfContentServiceProvider — each row is
     * {type, label, data}, where `data` is this section's full JSON
     * payload. See that provider's docblock for why sections aren't
     * decomposed into per-type sub-fields yet.
     *
     * @param  array<int, array<string, mixed>>  $sections
     */
    protected function writeSections(int $postId, array $sections): void
    {
        $rows = [];

        foreach ($sections as $i => $section) {
            $rows[] = [
                'type' => $section['type'],
                'label' => sprintf('%s #%d', $section['type'], $i + 1),
                'data' => wp_json_encode(
                    $section,
                    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
                ),
            ];
        }

        // update_post_meta()/rwmb_set_meta() both call wp_unslash() on the
        // way in — correct for their normal caller, $_POST data that
        // arrived pre-slashed by PHP's magic-quotes-emulation layer, but
        // we're calling them directly with a clean PHP string. wp_slash()
        // here cancels that out. Skipping it silently corrupts any JSON
        // value containing a real backslash: form.json's phone-number
        // regex ("...\\d{8}..."), the one place in the seeded content
        // this actually bit — stripslashes() turned "\\d" into "\d", not
        // a valid JSON escape, and every downstream json_decode() of that
        // one section failed with a syntax error while the other 20
        // pages (no backslashes anywhere in their content) looked fine.
        $rows = wp_slash($rows);

        if (function_exists('rwmb_set_meta')) {
            rwmb_set_meta($postId, 'cecf_sections', $rows);

            return;
        }

        // Meta Box isn't active — fall back to plain post meta so the
        // seed still succeeds and the data isn't silently dropped; it
        // just won't render in the Meta Box admin UI until the plugin
        // is active.
        update_post_meta($postId, 'cecf_sections', $rows);
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
