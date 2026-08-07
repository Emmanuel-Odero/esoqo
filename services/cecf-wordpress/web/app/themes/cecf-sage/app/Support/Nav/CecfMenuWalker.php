<?php

namespace App\Support\Nav;

use App\Support\Icon;
use Walker_Nav_Menu;

/**
 * Renders the primary nav menu (seeded by database/seeders/
 * NavigationSeeder.php) into the design template's two-level dropdown
 * markup: a top-level item with children becomes
 * `<div class="..."><a role="button">Label<svg class="ic cv">…</a>
 * <div class="drop">…child links…</div></div>`; a childless top-level
 * item becomes a plain `<a class="navlink">`.
 *
 * "Current page" highlighting uses WordPress's own current-menu-item /
 * current-menu-ancestor classes (set automatically by wp_nav_menu() based
 * on the real requested URL) rather than the template's original
 * JS-router-driven `data-kids` attribute + client-side route matching —
 * real page URLs make that unnecessary, and this way the correct item is
 * already highlighted on first paint, no JS required.
 */
class CecfMenuWalker extends Walker_Nav_Menu
{
    /**
     * WP_Walker sets `$this->has_children` fresh right before each
     * start_el() call, correct for whichever item is current at that
     * moment — but it's a single shared property on the walker instance,
     * so by the time end_el() runs for a parent item, it's been
     * overwritten by every child processed in between and no longer
     * reflects the parent. Captured per-item here (by item ID) in
     * start_el(), read back in end_el(), instead of trusting the
     * (by-then-stale) shared property a second time.
     *
     * @var array<int, bool>
     */
    protected array $hasChildrenById = [];

    public function start_lvl(&$output, $depth = 0, $args = null)
    {
        $output .= '<div class="drop">';
    }

    public function end_lvl(&$output, $depth = 0, $args = null)
    {
        $output .= '</div>';
    }

    public function start_el(&$output, $item, $depth = 0, $args = null, $id = 0)
    {
        $hasChildren = ! empty($this->has_children);
        $this->hasChildrenById[$item->ID] = $hasChildren;

        $classes = empty($item->classes) ? [] : (array) $item->classes;
        $isCurrent = in_array('current-menu-item', $classes, true);
        $isAncestor = in_array('current-menu-ancestor', $classes, true)
            || in_array('current-menu-parent', $classes, true);
        $url = esc_url($item->url ?: '#');
        $label = esc_html($item->title);

        if ($depth === 0 && $hasChildren) {
            // .on (not .open) matches the template's CSS — "this dropdown
            // contains the current page", computed server-side here from
            // WordPress's own current-menu-ancestor class. .open is a
            // separate, purely client-side class the nav JS toggles for
            // "currently expanded by a click" — never set from PHP.
            $output .= '<div'.($isAncestor ? ' class="on"' : '').'>';
            $output .= "<a href=\"{$url}\" role=\"button\" aria-haspopup=\"true\">{$label}";
            $output .= Icon::tag('chevron-down', ['cv'], 14);
            $output .= '</a>';

            return;
        }

        if ($depth === 0) {
            $navlinkClass = $isCurrent ? 'navlink cur' : 'navlink';
            $output .= "<a href=\"{$url}\" class=\"{$navlinkClass}\">{$label}</a>";

            return;
        }

        // Dropdown (depth 1) item.
        $curAttr = $isCurrent ? ' class="cur"' : '';
        $output .= "<a href=\"{$url}\"{$curAttr}>{$label}</a>";
    }

    public function end_el(&$output, $item, $depth = 0, $args = null)
    {
        if ($depth === 0 && ! empty($this->hasChildrenById[$item->ID])) {
            $output .= '</div>';
        }
    }
}
