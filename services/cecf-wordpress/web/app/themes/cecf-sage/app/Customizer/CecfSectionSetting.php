<?php

namespace App\Customizer;

use App\Content\SectionTypes;
use WP_Customize_Setting;

/**
 * One `data` object of one `cecf/<type>` block, on one page — i.e. one
 * entry in `App\View\Composers\PageSections::sections()` — as a
 * Customizer setting. Neither of core's two built-in `type`s fits: the
 * value isn't a `theme_mod` or a flat `option`, it's one block's
 * attributes nested inside a specific page's `post_content` (real
 * Gutenberg block comments, alongside every other section on that page)
 * — so `value()`/`update()` are overridden here to read/write exactly
 * that one block via `parse_blocks()`/`serialize_blocks()`, leaving
 * every sibling block on the page untouched.
 *
 * `preview()` is the other half core's `option`/`theme_mod` types get for
 * free and a custom type does not: while previewing an unsaved
 * changeset, this registers the edited value in `$previewed`
 * (keyed by post ID + block index) rather than writing it anywhere, and
 * `PageSections::sections()` consults `previewedValue()` for exactly
 * that page/index when `is_customize_preview()` — the standard
 * WordPress "changeset settings only became real on Publish, but the
 * preview iframe shows them immediately" behaviour, just implemented by
 * hand rather than inherited from a built-in type.
 */
class CecfSectionSetting extends WP_Customize_Setting
{
    public $type = 'cecf_section';

    /** @var array<int, array<int, array<string, mixed>>> [postId => [blockIndex => data]] */
    protected static array $previewed = [];

    public function __construct(
        $manager,
        $id,
        $args,
        protected int $postId,
        protected int $blockIndex,
    ) {
        parent::__construct($manager, $id, $args);
    }

    /**
     * @return array<string, mixed>
     */
    public function value()
    {
        $blocks = $this->blocks();
        $rawIndex = $this->rawIndex($blocks);

        return $rawIndex !== null && is_array($blocks[$rawIndex]['attrs']['data'] ?? null)
            ? $blocks[$rawIndex]['attrs']['data']
            : [];
    }

    /**
     * @param  array<string, mixed>  $value
     */
    protected function update($value): bool
    {
        $blocks = $this->blocks();
        $rawIndex = $this->rawIndex($blocks);

        if ($rawIndex === null) {
            return false;
        }

        // $blocks is every top-level block on the page, cecf/* or not —
        // only the one this setting owns gets touched; everything else
        // (including a non-cecf/* block an editor might have left, see
        // PageSections's own docblock) is reserialized back unchanged.
        $blocks[$rawIndex]['attrs']['data'] = is_array($value) ? $value : [];

        $result = wp_update_post([
            'ID' => $this->postId,
            'post_content' => wp_slash(serialize_blocks($blocks)),
        ], true);

        return ! is_wp_error($result);
    }

    /**
     * `$this->blockIndex` counts only `cecf/*` blocks (matching
     * PageSections::sections()'s own indexing) — resolves that back to
     * the block's real position in the page's full top-level block list,
     * which is what `update()` must patch in place.
     *
     * @param  array<int, array<string, mixed>>  $blocks
     */
    protected function rawIndex(array $blocks): ?int
    {
        $count = -1;

        foreach ($blocks as $i => $block) {
            if (SectionTypes::typeFromBlockName((string) ($block['blockName'] ?? '')) === null) {
                continue;
            }

            $count++;

            if ($count === $this->blockIndex) {
                return $i;
            }
        }

        return null;
    }

    public function preview(): bool
    {
        if ($this->is_previewed) {
            return true;
        }

        // Base WP_Customize_Setting::preview() only knows how to preview
        // its two built-in types (theme_mod/option), via filters on
        // get_theme_mod()/get_option() — for any other $this->type
        // (ours: 'cecf_section') it does nothing on its own, so this
        // overrides the whole method rather than calling parent::preview()
        // partway through. post_value() is what actually reads the
        // pending changeset's edited value for this setting out of
        // $_POST['customized'] (falling back to the real saved value if
        // this setting isn't part of the current changeset).
        $this->_previewed_blog_id = get_current_blog_id();
        $this->is_previewed = true;
        self::$previewed[$this->postId][$this->blockIndex] = $this->post_value($this->value());

        return true;
    }

    /**
     * Read by App\View\Composers\PageSections while previewing an
     * unsaved changeset — null means "no override, use the real saved
     * value" (either this setting was never registered/previewed, or the
     * changeset doesn't touch it).
     *
     * @return array<string, mixed>|null
     */
    public static function previewedValue(int $postId, int $blockIndex): ?array
    {
        return self::$previewed[$postId][$blockIndex] ?? null;
    }

    /**
     * Every top-level block on the page, unfiltered — deliberately not
     * reduced to cecf/* blocks only, since update() re-serializes
     * whatever this returns back into post_content and must not drop
     * anything else that's there.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function blocks(): array
    {
        $post = get_post($this->postId);

        return $post ? parse_blocks((string) $post->post_content) : [];
    }
}
