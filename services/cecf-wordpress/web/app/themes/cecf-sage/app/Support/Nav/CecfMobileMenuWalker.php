<?php

namespace App\Support\Nav;

use App\Support\Icon;
use Walker_Nav_Menu;

/**
 * Renders the same primary menu as CecfMenuWalker, but into the design
 * template's mobile-drawer markup (`.mgrp`/`.msubs`, expand/collapse
 * buttons) instead of the desktop dropdown markup — the two structures
 * differ enough (buttons vs. links, different icon placement, no hover
 * dropdown) that sharing one Walker would mean branching on a "mode" flag
 * throughout; two small single-purpose Walkers reads more clearly than one
 * that does both.
 *
 * The template hand-picked a specific icon per top-level nav group; this
 * maps that same intent by label rather than by menu-item ID (so re-
 * ordering or relabelling in wp-admin doesn't silently lose its icon),
 * falling back to a neutral icon for anything unmapped.
 */
class CecfMobileMenuWalker extends Walker_Nav_Menu
{
    protected const ICONS = [
        'Home' => 'home',
        'About us' => 'people',
        'Our approach' => 'target',
        'Impact' => 'bar-chart-line',
        'For Communities' => 'puzzle',
        'Partner with us' => 'globe',
        'News & events' => 'calendar',
        'Contact' => 'mail',
    ];

    protected const FALLBACK_ICON = 'grid';

    /**
     * See CecfMenuWalker's docblock on the same property — WP_Walker's
     * `$this->has_children` is only correct for the item start_el() is
     * currently rendering, not by the time end_el() runs for a parent.
     *
     * @var array<int, bool>
     */
    protected array $hasChildrenById = [];

    public function start_lvl(&$output, $depth = 0, $args = null)
    {
        $output .= '<div class="msubs">';
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
        $url = esc_url($item->url ?: '#');
        $label = esc_html($item->title);

        if ($depth === 0 && $hasChildren) {
            $icon = self::ICONS[$item->title] ?? self::FALLBACK_ICON;
            $output .= '<div class="mgrp"><button aria-expanded="false">';
            $output .= Icon::tag($icon, [], 18);
            $output .= $label;
            $output .= Icon::tag('chevron-down', ['cv'], 15);
            $output .= '</button>';

            return;
        }

        if ($depth === 0) {
            $icon = self::ICONS[$item->title] ?? self::FALLBACK_ICON;
            $linkClass = $isCurrent ? 'mgrp-link cur' : 'mgrp-link';
            $output .= "<a href=\"{$url}\" class=\"{$linkClass}\">";
            $output .= Icon::tag($icon, [], 18);
            $output .= "{$label}</a>";

            return;
        }

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
