<?php

namespace Database\Seeders;

use App\Content\ContentRepository;
use RuntimeException;

/**
 * Rebuilds the "Primary Navigation" wp_nav_menu (the location app/setup.php
 * already registers) from database/content/navigation.json's `primary`
 * tree, resolving each item's `page` key against the IDs PageSeeder
 * produced.
 *
 * Footer columns are NOT a wp_nav_menu — see
 * App\Providers\CecfContentServiceProvider's docblock and
 * SiteSettingsSeeder, which seeds them as structured data instead, per
 * docs/content-seeding-plan.md §3.3 (WordPress menus don't represent
 * grouped/headed link columns well).
 *
 * Idempotent by wipe-and-rebuild: every run deletes this menu's existing
 * items and recreates them from the JSON, so the menu always matches the
 * content source exactly. Fine for a dev/staging seeding tool; not meant
 * to coexist with hand-edits made directly in the wp-admin menu screen.
 */
class NavigationSeeder
{
    public const MENU_NAME = 'Primary Navigation';

    public const MENU_LOCATION = 'primary_navigation';

    public function __construct(protected ContentRepository $content)
    {
    }

    /**
     * @param  array<string, int>  $pageIds  page key => post ID, from PageSeeder
     */
    public function run(array $pageIds): int
    {
        $nav = $this->content->navigation();
        $menuId = $this->findOrCreateMenu();

        $this->clearItems($menuId);

        $position = 1;
        foreach ($nav['primary'] ?? [] as $item) {
            $position = $this->addItem($menuId, $item, $pageIds, 0, $position);
        }

        $this->assignToLocation($menuId);

        return $menuId;
    }

    /**
     * @param  array<string, mixed>  $item
     * @param  array<string, int>  $pageIds
     */
    protected function addItem(int $menuId, array $item, array $pageIds, int $parentId, int $position): int
    {
        $pageKey = $item['page'] ?? null;
        $pageId = $pageKey ? ($pageIds[$pageKey] ?? null) : null;

        $args = [
            'menu-item-title' => $item['label'],
            'menu-item-status' => 'publish',
            'menu-item-position' => $position,
            'menu-item-parent-id' => $parentId,
        ];

        if ($pageId) {
            $args['menu-item-object'] = 'page';
            $args['menu-item-object-id'] = $pageId;
            $args['menu-item-type'] = 'post_type';
        } else {
            // Every current entry in navigation.json's `primary` tree
            // resolves to a real page; this branch exists so a future
            // top-level label without a `page` key degrades to a
            // disabled placeholder link instead of a fatal error.
            $args['menu-item-url'] = '#';
            $args['menu-item-type'] = 'custom';
        }

        $itemId = wp_update_nav_menu_item($menuId, 0, $args);

        if (is_wp_error($itemId)) {
            throw new RuntimeException("Failed to add nav item '{$item['label']}': ".$itemId->get_error_message());
        }

        $position++;

        foreach ($item['children'] ?? [] as $child) {
            $position = $this->addItem($menuId, $child, $pageIds, $itemId, $position);
        }

        return $position;
    }

    protected function findOrCreateMenu(): int
    {
        $menu = wp_get_nav_menu_object(self::MENU_NAME);
        if ($menu) {
            return $menu->term_id;
        }

        $menuId = wp_create_nav_menu(self::MENU_NAME);
        if (is_wp_error($menuId)) {
            throw new RuntimeException('Failed to create the primary navigation menu: '.$menuId->get_error_message());
        }

        return $menuId;
    }

    protected function clearItems(int $menuId): void
    {
        foreach (wp_get_nav_menu_items($menuId) ?: [] as $item) {
            wp_delete_post($item->ID, true);
        }
    }

    protected function assignToLocation(int $menuId): void
    {
        $locations = get_theme_mod('nav_menu_locations', []);
        $locations[self::MENU_LOCATION] = $menuId;
        set_theme_mod('nav_menu_locations', $locations);
    }
}
